const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const store = require('./lib/store');
const awg = require('./lib/awg');
const tc = require('./lib/tc');
const keys = require('./lib/keys');

const fs = require('fs');

const PORT = process.env.PORT || 7500;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET env var is not set — refusing to start without it');
  process.exit(1);
}
const CONF_PATH = '/etc/amnezia/amneziawg/awg0.conf';
const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');
const SERVER_HOST = '45.76.15.203';

function loadAdminHash() {
  try {
    return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).passwordHash;
  } catch (err) {
    if (!process.env.ADMIN_PASSWORD_HASH) {
      console.error('No data/admin.json and no ADMIN_PASSWORD_HASH env var to bootstrap from');
      process.exit(1);
    }
    saveAdminHash(process.env.ADMIN_PASSWORD_HASH);
    return process.env.ADMIN_PASSWORD_HASH;
  }
}

function saveAdminHash(hash) {
  fs.mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_FILE, JSON.stringify({ passwordHash: hash }, null, 2));
}

let adminPasswordHash = loadAdminHash();

const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(password, adminPasswordHash)) {
    return res.status(401).json({ error: 'wrong password' });
  }
  req.session.authed = true;
  res.json({ ok: true });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !bcrypt.compareSync(currentPassword, adminPasswordHash)) {
    return res.status(401).json({ error: 'current password is wrong' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'new password must be at least 6 characters' });
  }
  adminPasswordHash = bcrypt.hashSync(newPassword, 10);
  saveAdminHash(adminPasswordHash);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// --- live polling engine -------------------------------------------------

let lastSample = {}; // pubkey -> { rxBytes, txBytes, t }
let snapshot = [];

function enforceExpiry(peers, now) {
  let confDirty = false;
  for (const p of peers) {
    if (p.enabled && p.expiresAt && new Date(p.expiresAt).getTime() <= now) {
      try {
        awg.removePeer(p.pubkey);
        p.enabled = false;
        confDirty = true;
      } catch (err) {
        // peer likely already removed; ignore
      }
    }
  }
  return confDirty;
}

// Kernel/userspace rx/tx counters reset to 0 whenever a peer is removed and
// re-added (toggle, expiry, quota trip, or an awg0 restart) — so total usage
// is tracked as an accumulator fed by per-tick deltas, not read directly off
// the live counters.
function accumulateUsageAndEnforceQuota(peers, dump) {
  let storeDirty = false;
  let confDirty = false;
  for (const p of peers) {
    const live = dump[p.pubkey];
    if (live) {
      const prev = lastSample[p.pubkey];
      if (prev) {
        const rxDelta = live.rxBytes - prev.rxBytes;
        const txDelta = live.txBytes - prev.txBytes;
        const delta = (rxDelta >= 0 ? rxDelta : live.rxBytes) + (txDelta >= 0 ? txDelta : live.txBytes);
        if (delta > 0) {
          p.usedBytesTotal = (p.usedBytesTotal || 0) + delta;
          storeDirty = true;
        }
      }
    }
    if (p.enabled && p.quotaBytes && (p.usedBytesTotal || 0) >= p.quotaBytes) {
      try {
        awg.removePeer(p.pubkey);
        p.enabled = false;
        confDirty = true;
        storeDirty = true;
      } catch (err) {
        // peer likely already removed; ignore
      }
    }
  }
  return { storeDirty, confDirty };
}

function computeSnapshot() {
  const dump = awg.dump();
  const now = Date.now();
  const peers = store.load();

  const expiryConfDirty = enforceExpiry(peers, now);
  const { storeDirty, confDirty: quotaConfDirty } = accumulateUsageAndEnforceQuota(peers, dump);
  const confDirty = expiryConfDirty || quotaConfDirty;
  if (confDirty) awg.persistToConf(peers, CONF_PATH);
  if (confDirty || storeDirty) store.save(peers);

  snapshot = peers.map((p) => {
    const live = dump[p.pubkey];
    const prev = lastSample[p.pubkey];
    let downKbps = 0;
    let upKbps = 0;
    let connected = false;

    if (live) {
      connected = live.latestHandshake > 0 && now / 1000 - live.latestHandshake < 180;
      if (prev) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0) {
          downKbps = Math.max(0, ((live.txBytes - prev.txBytes) * 8) / 1024 / dt);
          upKbps = Math.max(0, ((live.rxBytes - prev.rxBytes) * 8) / 1024 / dt);
        }
      }
      lastSample[p.pubkey] = { rxBytes: live.rxBytes, txBytes: live.txBytes, t: now };
    }

    return {
      name: p.name,
      pubkey: p.pubkey,
      ip: p.ip,
      enabled: p.enabled,
      downLimitKbps: p.downKbps || 0,
      upLimitKbps: p.upKbps || 0,
      connected,
      endpoint: live ? live.endpoint : null,
      lastHandshakeSecondsAgo: live && live.latestHandshake ? Math.round(now / 1000 - live.latestHandshake) : null,
      rxBytesTotal: live ? live.rxBytes : 0,
      txBytesTotal: live ? live.txBytes : 0,
      liveDownKbps: Math.round(downKbps),
      liveUpKbps: Math.round(upKbps),
      expiresAt: p.expiresAt || null,
      expiresInSeconds: p.expiresAt ? Math.round((new Date(p.expiresAt).getTime() - now) / 1000) : null,
      hasDownloadableConfig: !!keys.getPrivateKey(p.pubkey),
      usedBytesTotal: p.usedBytesTotal || 0,
      quotaBytes: p.quotaBytes || null,
      quotaRemainingBytes: p.quotaBytes ? Math.max(0, p.quotaBytes - (p.usedBytesTotal || 0)) : null,
    };
  });
}

setInterval(computeSnapshot, 2000);
computeSnapshot();
tc.ensureRootQdisc();

app.get('/api/peers', requireAuth, (req, res) => {
  res.json(snapshot);
});

app.get('/api/stream', requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const send = () => res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  send();
  const iv = setInterval(send, 2000);
  req.on('close', () => clearInterval(iv));
});

app.post('/api/peers/:pubkey/toggle', requireAuth, (req, res) => {
  const peers = store.load();
  const peer = peers.find((p) => p.pubkey === req.params.pubkey);
  if (!peer) return res.status(404).json({ error: 'not found' });

  peer.enabled = !peer.enabled;
  try {
    if (peer.enabled) {
      awg.addPeer(peer.pubkey, peer.ip);
    } else {
      awg.removePeer(peer.pubkey);
    }
    awg.persistToConf(peers, CONF_PATH);
    store.save(peers);
    res.json({ ok: true, enabled: peer.enabled });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/peers/:pubkey/name', requireAuth, (req, res) => {
  const peers = store.load();
  const peer = peers.find((p) => p.pubkey === req.params.pubkey);
  if (!peer) return res.status(404).json({ error: 'not found' });

  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'name required' });

  peer.name = name;
  try {
    awg.persistToConf(peers, CONF_PATH);
    store.save(peers);
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/peers/:pubkey/expiry', requireAuth, (req, res) => {
  const peers = store.load();
  const peer = peers.find((p) => p.pubkey === req.params.pubkey);
  if (!peer) return res.status(404).json({ error: 'not found' });

  const { days, clear } = req.body || {};
  if (clear) {
    peer.expiresAt = null;
  } else {
    const n = parseFloat(days);
    if (!n || n <= 0) return res.status(400).json({ error: 'days must be a positive number' });
    peer.expiresAt = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
  }
  store.save(peers);
  res.json({ ok: true, expiresAt: peer.expiresAt });
});

app.post('/api/peers/:pubkey/quota', requireAuth, (req, res) => {
  const peers = store.load();
  const peer = peers.find((p) => p.pubkey === req.params.pubkey);
  if (!peer) return res.status(404).json({ error: 'not found' });

  const { gb, clear } = req.body || {};
  if (clear) {
    peer.quotaBytes = null;
  } else {
    const n = parseFloat(gb);
    if (!n || n <= 0) return res.status(400).json({ error: 'gb must be a positive number' });
    peer.quotaBytes = Math.round(n * 1024 * 1024 * 1024);
  }
  store.save(peers);
  res.json({ ok: true, quotaBytes: peer.quotaBytes });
});

app.post('/api/peers/:pubkey/reset-usage', requireAuth, (req, res) => {
  const peers = store.load();
  const peer = peers.find((p) => p.pubkey === req.params.pubkey);
  if (!peer) return res.status(404).json({ error: 'not found' });

  peer.usedBytesTotal = 0;
  store.save(peers);
  res.json({ ok: true });
});

app.get('/api/peers/:pubkey/download', requireAuth, (req, res) => {
  const peers = store.load();
  const peer = peers.find((p) => p.pubkey === req.params.pubkey);
  if (!peer) return res.status(404).send('not found');

  const privateKey = keys.getPrivateKey(peer.pubkey);
  if (!privateKey) return res.status(404).send('no stored private key for this peer');

  let cfg;
  try {
    cfg = awg.getServerConfig(CONF_PATH);
  } catch (err) {
    return res.status(500).send('failed to read server config: ' + err);
  }

  const conf = `[Interface]
PrivateKey = ${privateKey}
Address = ${peer.ip}/24
DNS = 1.1.1.1, 8.8.8.8
Jc = ${cfg.jc}
Jmin = ${cfg.jmin}
Jmax = ${cfg.jmax}
S1 = ${cfg.s1}
S2 = ${cfg.s2}
H1 = ${cfg.h1}
H2 = ${cfg.h2}
H3 = ${cfg.h3}
H4 = ${cfg.h4}

[Peer]
PublicKey = ${cfg.pubkey}
Endpoint = ${SERVER_HOST}:${cfg.endpointPort}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${peer.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}.conf"`);
  res.send(conf);
});

app.post('/api/peers/:pubkey/limit', requireAuth, (req, res) => {
  const peers = store.load();
  const peer = peers.find((p) => p.pubkey === req.params.pubkey);
  if (!peer) return res.status(404).json({ error: 'not found' });

  const downKbps = Math.max(0, parseInt(req.body.downKbps, 10) || 0);
  const upKbps = Math.max(0, parseInt(req.body.upKbps, 10) || 0);

  try {
    if (downKbps === 0 && upKbps === 0) {
      tc.clearPeerLimit(peer.ip);
    } else {
      tc.setPeerLimit(peer.ip, downKbps, upKbps);
    }
    peer.downKbps = downKbps;
    peer.upKbps = upKbps;
    store.save(peers);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`vpn-admin listening on 127.0.0.1:${PORT}`);
});
