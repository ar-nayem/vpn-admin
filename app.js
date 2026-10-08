const path = require('path');
const express = require('express');
const session = require('express-session');
const { createInternalAuth } = require('./lib/internal-auth');
const { calculateEntitlement } = require('./storefront/catalog');
const { buildClientConfiguration } = require('./lib/client-config');

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
  internalSecret = null,
  internalNow = () => new Date(),
  adminStorefront = null,
  qrUpload = null,
}) {
  if (!sessionSecret) throw new Error('sessionSecret is required');
  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) {
      req.rawBody = Buffer.from(buffer);
    },
  }));
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

  async function sendAsyncOperation(res, operation, successStatus = 200) {
    try {
      return res.status(successStatus).json(await operation());
    } catch (err) {
      const status = Number.isInteger(err.status) ? err.status : 500;
      if (status >= 500) console.error(err);
      return res.status(status).json({ error: status >= 500 ? 'operation failed' : err.message, code: err.code });
    }
  }

  if (internalSecret) {
    const requireInternalAuth = createInternalAuth({ secret: internalSecret, now: internalNow });
    const internalOperation = (res, operation, status = 200) => {
      try {
        return res.status(status).json(operation());
      } catch (err) {
        return res.status(Number.isInteger(err.status) ? err.status : 500).json({
          error: Number.isInteger(err.status) && err.status < 500 ? err.message : 'operation failed',
          code: err.code,
        });
      }
    };

    app.post('/internal/v1/profiles/trial', requireInternalAuth, (req, res) => internalOperation(res, () => (
      provisioning.createCustomerProfile({
        customerRef: req.body.customerRef,
        customerName: req.body.customerName,
        codeName: req.body.codeName,
        entitlement: {
          planId: 'trial',
          planName: 'Free trial',
          quotaBytes: 1024 ** 3,
          downKbps: 5120,
          upKbps: 5120,
          expiresAt: null,
        },
      })
    ), 201));

    app.post('/internal/v1/profiles/paid', requireInternalAuth, (req, res) => internalOperation(res, () => (
      provisioning.createCustomerProfile({
        customerRef: req.body.customerRef,
        customerName: req.body.customerName,
        codeName: req.body.codeName,
        entitlement: calculateEntitlement(req.body.planId, Number(req.body.months), internalNow()),
      })
    ), 201));

    app.post('/internal/v1/profiles/:deviceId/upgrade', requireInternalAuth, (req, res) => internalOperation(res, () => (
      provisioning.upgradeCustomerProfile({
        deviceId: req.params.deviceId,
        entitlement: calculateEntitlement(req.body.planId, Number(req.body.months), internalNow()),
      })
    )));

    app.get('/internal/v1/profiles/:deviceId/status', requireInternalAuth, (req, res) => internalOperation(res, () => {
      const peers = peerStore.load();
      const peer = peers.find((item) => item.deviceId === req.params.deviceId && !item.archivedAt);
      if (!peer) return { found: false };
      return {
        found: true,
        deviceId: peer.deviceId,
        enabled: peer.enabled,
        quotaBytes: peer.quotaBytes || null,
        usedBytes: peer.usedBytesTotal || 0,
        expiresAt: peer.expiresAt || null,
        downKbps: peer.downKbps || 0,
        upKbps: peer.upKbps || 0,
      };
    }));

    app.get('/internal/v1/profiles/:deviceId/configuration', requireInternalAuth, (req, res) => internalOperation(res, () => {
      const peers = peerStore.load();
      const peer = peers.find((item) => item.deviceId === req.params.deviceId && !item.archivedAt);
      if (!peer) throw Object.assign(new Error('profile not found'), { status: 404, code: 'NOT_FOUND' });
      const privateKey = keyStore.getPrivateKey(peer.pubkey);
      if (!privateKey) throw Object.assign(new Error('configuration unavailable'), { status: 404, code: 'CONFIG_UNAVAILABLE' });
      const userDevices = peers.filter((item) => item.userNumber === peer.userNumber);
      return buildClientConfiguration({ peer, privateKey, serverConfig: awg.getServerConfig(confPath), serverHost, deviceNumber: userDevices.indexOf(peer) + 1 });
    }));
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
    const userDevices = peers.filter((item) => item.userNumber === peer.userNumber);
    const deviceNumber = userDevices.indexOf(peer) + 1;
    const clientConfig = buildClientConfiguration({ peer, privateKey, serverConfig: config, serverHost, deviceNumber });
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${clientConfig.filename}"`);
    return res.send(clientConfig.content);
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

  if (adminStorefront) {
    app.get('/api/storefront/orders', requireAuth, (req, res) => res.json({ orders: adminStorefront.listOrders() }));
    app.post('/api/storefront/orders/:id/approve', requireAuth, (req, res) => sendAsyncOperation(res, () => adminStorefront.approveOrder({ orderId: req.params.id, adminRef: 'admin' })));
    app.post('/api/storefront/orders/:id/retry', requireAuth, (req, res) => sendAsyncOperation(res, () => adminStorefront.retryProvisioning({ orderId: req.params.id, adminRef: 'admin' })));
    app.post('/api/storefront/orders/:id/reject', requireAuth, (req, res) => sendOperation(res, () => adminStorefront.rejectOrder({ orderId: req.params.id, adminRef: 'admin', reason: req.body.reason })));
    app.get('/api/storefront/orders/:id/proof', requireAuth, (req, res) => {
      const proof = adminStorefront.proofPath(req.params.id);
      if (!proof) return res.status(404).send('not found');
      return res.sendFile(proof.filename, { root: proof.root, dotfiles: 'deny' });
    });
    app.get('/api/storefront/payment-qr', requireAuth, (req, res) => res.json(adminStorefront.qrStatus()));
    if (qrUpload) app.post('/api/storefront/payment-qr/:method', requireAuth, qrUpload, (req, res) => sendAsyncOperation(res, () => adminStorefront.storeQrImage(req.params.method, req.file, 'admin')));
  }

  if (publicDir) {
    app.use('/admin', express.static(publicDir));
    app.use(express.static(publicDir));
  }
  return app;
}

module.exports = { createApp };
