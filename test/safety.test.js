const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createProvisioningService } = require('../lib/provisioning');
const { createUsageSnapshotCycle } = require('../storefront/services/usage-collector');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('every provisioning workflow is expressible without a VPN restart or reload', () => {
  let peers = Array.from({ length: 21 }, (_, i) => ({
    name: `Peer ${i + 1}`,
    pubkey: `legacy-${i + 1}`,
    ip: `10.66.67.${i + 2}`,
    enabled: true,
  }));
  let keys = {};
  let generated = 0;
  const operations = [];
  const peerStore = {
    load: () => clone(peers),
    save: (value) => { peers = clone(value); },
  };
  const keyStore = {
    load: () => clone(keys),
    replace: (value) => { keys = clone(value); },
  };
  const awg = {
    generateKeyPair() {
      operations.push('generate-key');
      generated += 1;
      return { privateKey: `private-${generated}`, publicKey: `public-${generated}` };
    },
    addPeer() { operations.push('add-peer'); },
    removePeer() { operations.push('remove-peer'); },
    readPersistentConfig() { operations.push('read-config'); return '[Interface]\n'; },
    writePersistentConfig() { operations.push('write-config'); },
    persistToConf() { operations.push('persist-config'); },
  };
  const trafficControl = {
    setPeerLimit() { operations.push('set-peer-limit'); },
    clearPeerLimit() { operations.push('clear-peer-limit'); },
  };
  let id = 0;
  const service = createProvisioningService({
    peerStore,
    keyStore,
    awg,
    clientPrefix: '10.66.67',
    confPath: '/fake/awg0.conf',
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    randomUUID: () => `device-${++id}`,
    trafficControl,
  });

  const user = service.createUser({ userName: 'Alice', devices: ['Phone'] });
  const added = service.addDevice(user.userNumber, { deviceName: 'Laptop' });
  service.archiveDevice(added.deviceId);
  service.archiveUser(user.userNumber);
  const trial = service.createCustomerProfile({
    customerRef: 'customer-1',
    customerName: 'Bob',
    codeName: 'Phone',
    entitlement: {
      planId: 'trial',
      planName: 'Free Trial',
      quotaBytes: 1_000_000_000,
      downKbps: 5_000,
      upKbps: 5_000,
      expiresAt: null,
    },
  });
  service.upgradeCustomerProfile({
    deviceId: trial.deviceId,
    entitlement: {
      planId: 'premium',
      planName: 'Premium',
      quotaBytes: 120_000_000_000,
      downKbps: 0,
      upKbps: 0,
      expiresAt: '2026-11-03T10:00:00.000Z',
    },
  });

  const allowed = new Set([
    'generate-key',
    'add-peer',
    'remove-peer',
    'read-config',
    'write-config',
    'persist-config',
    'set-peer-limit',
    'clear-peer-limit',
  ]);
  assert.deepEqual([...new Set(operations.filter((operation) => !allowed.has(operation)))], []);
});

test('usage collection failures do not prevent a completed snapshot or later timer cycle', () => {
  assert.equal(typeof createUsageSnapshotCycle, 'function');

  const completedSnapshot = [{ deviceId: 'device-1', rxBytesTotal: 128, txBytesTotal: 256 }];
  const recorded = [];
  const logged = [];
  let computed = 0;
  const runCycle = createUsageSnapshotCycle({
    computeSnapshot() {
      computed += 1;
      return completedSnapshot;
    },
    collector: {
      record(snapshot) {
        recorded.push(snapshot);
        throw new Error('sensitive customer-specific details');
      },
    },
    logger: { error: (message) => logged.push(message) },
  });

  assert.equal(runCycle(), completedSnapshot);
  assert.equal(runCycle(), completedSnapshot);
  assert.equal(computed, 2);
  assert.deepEqual(recorded, [completedSnapshot, completedSnapshot]);
  assert.deepEqual(logged, ['Usage analytics collection failed', 'Usage analytics collection failed']);
});

test('analytics modules contain no VPN or account mutation controls', () => {
  const forbidden = ['awg set', 'awg-quick', 'systemctl', 'restart', 'reload', 'removePeer', 'toggleDevice'];
  const analyticsFiles = [
    '../storefront/services/usage-analytics.js',
    '../storefront/services/usage-collector.js',
    '../storefront/repositories/usage-history.js',
  ];

  for (const file of analyticsFiles) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const operation of forbidden) {
      assert.equal(source.includes(operation), false, `${file} contains forbidden operation ${operation}`);
    }
  }
});
