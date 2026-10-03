const path = require('path');
const express = require('express');
const session = require('express-session');

function createApp({
  provisioning,
  peerStore,
  keyStore,
  awg,
  tc,
  sessionSecret,
  admin,
  getSnapshot = () => [],
  confPath = '/etc/amnezia/amneziawg/awg0.conf',
  serverHost = '45.76.15.203',
  publicDir = path.join(__dirname, 'public'),
}) {
  if (!sessionSecret) throw new Error('sessionSecret is required');
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 },
  }));

  function requireAuth(req, res, next) {
    if (req.session && req.session.authed) return next();
    return res.status(401).json({ error: 'unauthorized' });
  }

  function sendOperation(res, operation, successStatus = 200) {
    try {
      return res.status(successStatus).json(operation());
    } catch (err) {
      const status = Number.isInteger(err.status) ? err.status : 500;
      if (status >= 500) console.error(err);
      return res.status(status).json({ error: status >= 500 ? 'operation failed' : err.message, code: err.code });
    }
  }

  app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (!password || !admin.verifyPassword(password)) {
      return res.status(401).json({ error: 'wrong password' });
    }
    req.session.authed = true;
    return res.json({ ok: true });
  });

  app.post('/api/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !admin.verifyPassword(currentPassword)) {
      return res.status(401).json({ error: 'current password is wrong' });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'new password must be at least 6 characters' });
    }
    admin.changePassword(newPassword);
    return res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/session', (req, res) => {
    res.json({ authed: !!(req.session && req.session.authed) });
  });

  app.get('/api/peers', requireAuth, (req, res) => res.json(getSnapshot()));

  app.get('/api/stream', requireAuth, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const send = () => res.write(`data: ${JSON.stringify(getSnapshot())}\n\n`);
    send();
    const interval = setInterval(send, 2000);
    req.on('close', () => clearInterval(interval));
  });

  app.get('/api/users', requireAuth, (_req, res) => sendOperation(res, () => provisioning.listUsers()));

  app.post('/api/users', requireAuth, (req, res) => {
    const { userName, devices } = req.body || {};
    if (!String(userName || '').trim() || !Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ error: 'user name and at least one device are required' });
    }
    return sendOperation(res, () => provisioning.createUser({ userName, devices }), 201);
  });

  app.post('/api/users/:userNumber/devices', requireAuth, (req, res) => {
    const userNumber = Number(req.params.userNumber);
    if (!Number.isInteger(userNumber) || userNumber < 1 || !String(req.body?.deviceName || '').trim()) {
      return res.status(400).json({ error: 'valid user number and device name are required' });
    }
    return sendOperation(res, () => provisioning.addDevice(userNumber, { deviceName: req.body.deviceName }), 201);
  });

  app.delete('/api/users/:userNumber', requireAuth, (req, res) => {
    const userNumber = Number(req.params.userNumber);
    if (!Number.isInteger(userNumber) || Number(req.body?.confirmUserNumber) !== userNumber) {
      return res.status(400).json({ error: 'user number confirmation does not match' });
    }
    return sendOperation(res, () => provisioning.archiveUser(userNumber));
  });

  app.delete('/api/devices/:deviceId', requireAuth, (req, res) => {
    const { deviceId } = req.params;
    if (!deviceId || req.body?.confirmDeviceId !== deviceId) {
      return res.status(400).json({ error: 'device confirmation does not match' });
    }
    return sendOperation(res, () => provisioning.archiveDevice(deviceId));
  });

  app.post('/api/peers/:pubkey/toggle', requireAuth, (req, res) => {
    const peers = peerStore.load();
    const peer = peers.find((item) => item.pubkey === req.params.pubkey);
    if (!peer) return res.status(404).json({ error: 'not found' });
    peer.enabled = !peer.enabled;
    try {
      if (peer.enabled) awg.addPeer(peer.pubkey, peer.ip);
      else awg.removePeer(peer.pubkey);
      awg.persistToConf(peers, confPath);
      peerStore.save(peers);
      return res.json({ ok: true, enabled: peer.enabled });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/peers/:pubkey/name', requireAuth, (req, res) => {
    const peers = peerStore.load();
    const peer = peers.find((item) => item.pubkey === req.params.pubkey);
    if (!peer) return res.status(404).json({ error: 'not found' });
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (peer.deviceId) {
      peer.deviceName = name;
      peer.name = `${peer.userName} — ${name}`;
    } else {
      peer.name = name;
    }
    try {
      awg.persistToConf(peers, confPath);
      peerStore.save(peers);
      return res.json({ ok: true, name });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/peers/:pubkey/expiry', requireAuth, (req, res) => {
    const peers = peerStore.load();
    const peer = peers.find((item) => item.pubkey === req.params.pubkey);
    if (!peer) return res.status(404).json({ error: 'not found' });
    const { days, clear } = req.body || {};
    if (clear) peer.expiresAt = null;
    else {
      const value = parseFloat(days);
      if (!value || value <= 0) return res.status(400).json({ error: 'days must be a positive number' });
      peer.expiresAt = new Date(Date.now() + value * 24 * 60 * 60 * 1000).toISOString();
    }
    peerStore.save(peers);
    return res.json({ ok: true, expiresAt: peer.expiresAt });
  });

  app.post('/api/peers/:pubkey/quota', requireAuth, (req, res) => {
    const peers = peerStore.load();
    const peer = peers.find((item) => item.pubkey === req.params.pubkey);
    if (!peer) return res.status(404).json({ error: 'not found' });
    const { gb, clear } = req.body || {};
    if (clear) peer.quotaBytes = null;
    else {
      const value = parseFloat(gb);
      if (!value || value <= 0) return res.status(400).json({ error: 'gb must be a positive number' });
      peer.quotaBytes = Math.round(value * 1024 * 1024 * 1024);
    }
    peerStore.save(peers);
    return res.json({ ok: true, quotaBytes: peer.quotaBytes });
  });

  app.post('/api/peers/:pubkey/reset-usage', requireAuth, (req, res) => {
    const peers = peerStore.load();
    const peer = peers.find((item) => item.pubkey === req.params.pubkey);
    if (!peer) return res.status(404).json({ error: 'not found' });
    peer.usedBytesTotal = 0;
    peerStore.save(peers);
    return res.json({ ok: true });
  });

  app.get('/api/peers/:pubkey/download', requireAuth, (req, res) => {
    const peers = peerStore.load();
    const peer = peers.find((item) => item.pubkey === req.params.pubkey);
    if (!peer || peer.archivedAt) return res.status(404).send('not found');
    const privateKey = keyStore.getPrivateKey(peer.pubkey);
    if (!privateKey) return res.status(404).send('no stored private key for this peer');
    let config;
    try { config = awg.getServerConfig(confPath); } catch (err) {
      return res.status(500).send(`failed to read server config: ${err}`);
    }
    const clientConfig = `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${peer.ip}/24\nDNS = 1.1.1.1, 8.8.8.8\nJc = ${config.jc}\nJmin = ${config.jmin}\nJmax = ${config.jmax}\nS1 = ${config.s1}\nS2 = ${config.s2}\nH1 = ${config.h1}\nH2 = ${config.h2}\nH3 = ${config.h3}\nH4 = ${config.h4}\n\n[Peer]\nPublicKey = ${config.pubkey}\nEndpoint = ${serverHost}:${config.endpointPort}\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n`;
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${peer.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}.conf"`);
    return res.send(clientConfig);
  });

  app.post('/api/peers/:pubkey/limit', requireAuth, (req, res) => {
    const peers = peerStore.load();
    const peer = peers.find((item) => item.pubkey === req.params.pubkey);
    if (!peer) return res.status(404).json({ error: 'not found' });
    const downKbps = Math.max(0, parseInt(req.body.downKbps, 10) || 0);
    const upKbps = Math.max(0, parseInt(req.body.upKbps, 10) || 0);
    try {
      if (downKbps === 0 && upKbps === 0) tc.clearPeerLimit(peer.ip);
      else tc.setPeerLimit(peer.ip, downKbps, upKbps);
      peer.downKbps = downKbps;
      peer.upKbps = upKbps;
      peerStore.save(peers);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  if (publicDir) app.use(express.static(publicDir));
  return app;
}

module.exports = { createApp };
