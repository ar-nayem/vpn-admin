const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const { createApp } = require('./app');
const store = require('./lib/store');
const keys = require('./lib/keys');
const awg = require('./lib/awg');
const tc = require('./lib/tc');
const { createProvisioningService } = require('./lib/provisioning');
const { projectPeer } = require('./lib/user-model');
const { openDatabase } = require('./storefront/db/database');
const { createProfileRepository } = require('./storefront/repositories/profiles');
const { createOrderRepository } = require('./storefront/repositories/orders');
const { createSettingsRepository } = require('./storefront/repositories/settings');
const { createOutboxRepository } = require('./storefront/repositories/outbox');
const { createDownloadTokenRepository } = require('./storefront/repositories/download-tokens');
const { createOrderService, createQrService } = require('./storefront/services/orders');
const { createDownloadService } = require('./storefront/services/downloads');
const { createNotificationService } = require('./storefront/services/email');
const { createStorefrontAdminService } = require('./storefront/services/admin');
const { createPrivateImageStore, createImageUpload } = require('./storefront/middleware/uploads');
const { calculateEntitlement } = require('./storefront/catalog');

const PORT = process.env.PORT || 7500;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET env var is not set — refusing to start without it');
  process.exit(1);
}

const CONF_PATH = process.env.AWG_CONF_PATH || '/etc/amnezia/amneziawg/awg0.conf';
const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');
const SERVER_HOST = process.env.VPN_SERVER_HOST || '45.76.15.203';
const CLIENT_PREFIX = process.env.VPN_CLIENT_PREFIX || '10.66.67';

function saveAdminHash(hash) {
  fs.mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
  const temporary = `${ADMIN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ passwordHash: hash }, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, ADMIN_FILE);
}

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

let adminPasswordHash = loadAdminHash();
const admin = {
  verifyPassword(password) {
    return bcrypt.compareSync(password, adminPasswordHash);
  },
  changePassword(password) {
    adminPasswordHash = bcrypt.hashSync(password, 10);
    saveAdminHash(adminPasswordHash);
  },
};

let lastSample = {};
let snapshot = [];

function enforceExpiry(peers, now) {
  let changed = false;
  for (const peer of peers) {
    if (peer.enabled && peer.expiresAt && new Date(peer.expiresAt).getTime() <= now) {
      try { awg.removePeer(peer.pubkey); } catch (err) { /* peer may already be absent */ }
      peer.enabled = false;
      changed = true;
    }
  }
  return changed;
}

function accumulateUsageAndEnforceQuota(peers, dump) {
  let storeDirty = false;
  let confDirty = false;
  for (const peer of peers) {
    const live = dump[peer.pubkey];
    if (live) {
      const previous = lastSample[peer.pubkey];
      if (previous) {
        const rxDelta = live.rxBytes - previous.rxBytes;
        const txDelta = live.txBytes - previous.txBytes;
        const delta = (rxDelta >= 0 ? rxDelta : live.rxBytes) + (txDelta >= 0 ? txDelta : live.txBytes);
        if (delta > 0) {
          peer.usedBytesTotal = (peer.usedBytesTotal || 0) + delta;
          storeDirty = true;
        }
      }
    }
    if (peer.enabled && peer.quotaBytes && (peer.usedBytesTotal || 0) >= peer.quotaBytes) {
      try { awg.removePeer(peer.pubkey); } catch (err) { /* peer may already be absent */ }
      peer.enabled = false;
      confDirty = true;
      storeDirty = true;
    }
  }
  return { storeDirty, confDirty };
}

function computeSnapshot() {
  const dump = awg.dump();
  const now = Date.now();
  const peers = store.load();
  const expiryDirty = enforceExpiry(peers, now);
  const quota = accumulateUsageAndEnforceQuota(peers, dump);
  const confDirty = expiryDirty || quota.confDirty;
  if (confDirty) awg.persistToConf(peers, CONF_PATH);
  if (confDirty || quota.storeDirty) store.save(peers);

  snapshot = peers.map((peer, index) => {
    const identity = projectPeer(peer, index);
    const live = dump[peer.pubkey];
    const previous = lastSample[peer.pubkey];
    let downKbps = 0;
    let upKbps = 0;
    let connected = false;
    if (live) {
      connected = live.latestHandshake > 0 && now / 1000 - live.latestHandshake < 180;
      if (previous) {
        const elapsed = (now - previous.t) / 1000;
        if (elapsed > 0) {
          downKbps = Math.max(0, ((live.txBytes - previous.txBytes) * 8) / 1024 / elapsed);
          upKbps = Math.max(0, ((live.rxBytes - previous.rxBytes) * 8) / 1024 / elapsed);
        }
      }
      lastSample[peer.pubkey] = { rxBytes: live.rxBytes, txBytes: live.txBytes, t: now };
    }
    return {
      name: peer.name,
      pubkey: peer.pubkey,
      ip: peer.ip,
      enabled: peer.enabled,
      userNumber: identity.userNumber,
      userName: identity.userName,
      deviceId: identity.deviceId,
      deviceName: identity.deviceName,
      archivedAt: identity.archivedAt,
      downLimitKbps: peer.downKbps || 0,
      upLimitKbps: peer.upKbps || 0,
      connected,
      endpoint: live ? live.endpoint : null,
      lastHandshakeSecondsAgo: live && live.latestHandshake ? Math.round(now / 1000 - live.latestHandshake) : null,
      rxBytesTotal: live ? live.rxBytes : 0,
      txBytesTotal: live ? live.txBytes : 0,
      liveDownKbps: Math.round(downKbps),
      liveUpKbps: Math.round(upKbps),
      expiresAt: peer.expiresAt || null,
      expiresInSeconds: peer.expiresAt ? Math.round((new Date(peer.expiresAt).getTime() - now) / 1000) : null,
      hasDownloadableConfig: !identity.archivedAt && !!keys.getPrivateKey(peer.pubkey),
      usedBytesTotal: peer.usedBytesTotal || 0,
      quotaBytes: peer.quotaBytes || null,
      quotaRemainingBytes: peer.quotaBytes ? Math.max(0, peer.quotaBytes - (peer.usedBytesTotal || 0)) : null,
    };
  });
}

const provisioning = createProvisioningService({
  peerStore: store,
  keyStore: keys,
  awg,
  clientPrefix: CLIENT_PREFIX,
  confPath: CONF_PATH,
  trafficControl: tc,
});

function createStorefrontAdministration() {
  const databasePath = process.env.STOREFRONT_DATABASE_PATH;
  const storagePath = process.env.STOREFRONT_STORAGE_PATH;
  if (!databasePath || !storagePath) return {};
  const db = openDatabase(databasePath);
  const profiles = createProfileRepository(db);
  const orderRepository = createOrderRepository(db);
  const settings = createSettingsRepository(db);
  const outboxKey = process.env.OUTBOX_KEY ? Buffer.from(process.env.OUTBOX_KEY, 'base64') : null;
  const downloadKey = process.env.DOWNLOAD_KEY ? Buffer.from(process.env.DOWNLOAD_KEY, 'base64') : null;
  const directProvisioning = {
    createPaid(input) {
      return provisioning.createCustomerProfile({
        customerRef: input.customerRef,
        customerName: input.customerName,
        codeName: input.codeName,
        entitlement: calculateEntitlement(input.planId, input.months, new Date()),
      });
    },
    upgrade(deviceId, input) {
      return provisioning.upgradeCustomerProfile({
        deviceId,
        entitlement: calculateEntitlement(input.planId, input.months, new Date()),
      });
    },
    getConfiguration(deviceId) {
      const peers = store.load();
      const peer = peers.find((item) => item.deviceId === deviceId && !item.archivedAt);
      if (!peer) throw new Error('VPN profile not found');
      const privateKey = keys.getPrivateKey(peer.pubkey);
      if (!privateKey) throw new Error('VPN configuration unavailable');
      const userDevices = peers.filter((item) => item.userNumber === peer.userNumber);
      return buildClientConfiguration({ peer, privateKey, serverConfig: awg.getServerConfig(CONF_PATH), serverHost: SERVER_HOST, deviceNumber: userDevices.indexOf(peer) + 1 });
    },
  };
  let notifications = {};
  if (outboxKey && outboxKey.length === 32 && downloadKey && downloadKey.length === 32) {
    const downloads = createDownloadService({ db, tokens: createDownloadTokenRepository(db), downloadKey });
    notifications = createNotificationService({ outbox: createOutboxRepository(db), outboxKey, downloads, provisioning: directProvisioning });
  }
  const proofStoragePath = path.join(storagePath, 'proofs');
  const qrStoragePath = path.join(storagePath, 'qr');
  const orderService = createOrderService({
    db,
    orders: orderRepository,
    profiles,
    verification: { consumeGrant: () => false },
    proofStorage: createPrivateImageStore({ storageDir: proofStoragePath }),
    provisioning: directProvisioning,
    notifications,
  });
  const qr = createQrService({ db, settings, storage: createPrivateImageStore({ storageDir: qrStoragePath }) });
  return {
    adminStorefront: createStorefrontAdminService({ db, orders: orderService, qr, proofStoragePath }),
    qrUpload: createImageUpload('qr'),
  };
}

const storefrontAdministration = createStorefrontAdministration();

const app = createApp({
  provisioning,
  peerStore: store,
  keyStore: keys,
  awg,
  tc,
  sessionSecret: SESSION_SECRET,
  admin,
  getSnapshot: () => snapshot,
  confPath: CONF_PATH,
  serverHost: SERVER_HOST,
  internalSecret: process.env.INTERNAL_SHARED_SECRET || null,
  ...storefrontAdministration,
});

computeSnapshot();
setInterval(computeSnapshot, 2000);
tc.ensureRootQdisc();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`vpn-admin listening on 127.0.0.1:${PORT}`);
});
