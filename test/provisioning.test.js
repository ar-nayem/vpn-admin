const test = require('node:test');
const assert = require('node:assert/strict');

const { createProvisioningService } = require('../lib/provisioning');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function legacyPeers(count = 21) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Peer ${i + 1}`,
    pubkey: `legacy-public-${i + 1}`,
    ip: `10.66.67.${i + 2}`,
    enabled: true,
    downKbps: 0,
    upKbps: 0,
  }));
}

function memoryStore(initial) {
  let value = clone(initial);
  return {
    load: () => clone(value),
    save: (next) => { value = clone(next); },
  };
}

function keyStore(initial = {}) {
  let value = clone(initial);
  return {
    load: () => clone(value),
    replace: (next) => { value = clone(next); },
    getPrivateKey: (pubkey) => value[pubkey] || null,
  };
}

function fakeAwg({ failAddAt = 0 } = {}) {
  const operations = [];
  let generated = 0;
  let addCount = 0;
  let config = '[Interface]\nAddress = 10.66.67.1/24\n';
  return {
    operations,
    generateKeyPair() {
      generated += 1;
      operations.push(['generate']);
      return { privateKey: `private-${generated}`, publicKey: `public-${generated}` };
    },
    addPeer(pubkey, ip) {
      addCount += 1;
      operations.push(['add', pubkey, ip]);
      if (failAddAt === addCount) throw new Error('simulated add failure');
    },
    removePeer(pubkey) {
      operations.push(['remove', pubkey]);
    },
    readPersistentConfig() {
      operations.push(['read-config']);
      return config;
    },
    writePersistentConfig(_path, text) {
      operations.push(['write-config']);
      config = text;
    },
    persistToConf(peers) {
      operations.push(['persist', peers.map((peer) => peer.pubkey)]);
      config = `peers=${peers.filter((peer) => peer.enabled && !peer.archivedAt).length}`;
    },
  };
}

function serviceFixture(options = {}) {
  const peers = legacyPeers();
  const peerStore = memoryStore(peers);
  const privateKeys = keyStore({ 'legacy-public-1': 'existing-private' });
  const awg = fakeAwg(options);
  let uuid = 0;
  const service = createProvisioningService({
    peerStore,
    keyStore: privateKeys,
    awg,
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    randomUUID: () => `device-${++uuid}`,
    clientPrefix: '10.66.67',
    confPath: '/fake/awg0.conf',
  });
  return { service, peers, peerStore, privateKeys, awg };
}

test('creates User 22 with distinct device keys and unused IPs', () => {
  const { service, peers, peerStore, privateKeys, awg } = serviceFixture();
  const before = clone(peers);

  const result = service.createUser({
    userName: 'Alice',
    devices: ['iPhone', 'Laptop'],
  });

  assert.equal(result.userNumber, 22);
  assert.deepEqual(result.devices.map(({ deviceName, ip, pubkey }) => ({ deviceName, ip, pubkey })), [
    { deviceName: 'iPhone', ip: '10.66.67.23', pubkey: 'public-1' },
    { deviceName: 'Laptop', ip: '10.66.67.24', pubkey: 'public-2' },
  ]);
  assert.deepEqual(peerStore.load().slice(0, 21), before);
  assert.deepEqual(privateKeys.load(), {
    'legacy-public-1': 'existing-private',
    'public-1': 'private-1',
    'public-2': 'private-2',
  });
  assert.deepEqual(awg.operations.filter(([operation]) => operation === 'add'), [
    ['add', 'public-1', '10.66.67.23'],
    ['add', 'public-2', '10.66.67.24'],
  ]);
});

test('partial create failure rolls back only newly added peers and stores', () => {
  const { service, peers, peerStore, privateKeys, awg } = serviceFixture({ failAddAt: 2 });

  assert.throws(
    () => service.createUser({ userName: 'Alice', devices: ['iPhone', 'Laptop'] }),
    /simulated add failure/
  );

  assert.deepEqual(peerStore.load(), peers);
  assert.deepEqual(privateKeys.load(), { 'legacy-public-1': 'existing-private' });
  assert.deepEqual(awg.operations.filter(([operation]) => operation === 'remove'), [
    ['remove', 'public-1'],
  ]);
  assert.equal(
    awg.operations.some(([operation, pubkey]) => operation === 'remove' && pubkey.startsWith('legacy-')),
    false
  );
});

test('adds another device to User 22 without changing existing devices', () => {
  const { service, peerStore } = serviceFixture();
  service.createUser({ userName: 'Alice', devices: ['iPhone'] });
  const before = peerStore.load();

  const device = service.addDevice(22, { deviceName: 'Laptop' });

  assert.equal(device.userNumber, 22);
  assert.equal(device.deviceName, 'Laptop');
  assert.deepEqual(peerStore.load().slice(0, before.length), before);
});

test('archives User 22, retains metadata, and removes only its keys', () => {
  const { service, peerStore, privateKeys, awg } = serviceFixture();
  service.createUser({ userName: 'Alice', devices: ['iPhone', 'Laptop'] });
  awg.operations.length = 0;

  const result = service.archiveUser(22);

  assert.equal(result.userNumber, 22);
  const archived = peerStore.load().filter((peer) => peer.userNumber === 22);
  assert.equal(archived.length, 2);
  assert.equal(archived.every((peer) => peer.enabled === false && peer.archivedAt), true);
  assert.deepEqual(privateKeys.load(), { 'legacy-public-1': 'existing-private' });
  assert.deepEqual(awg.operations.filter(([operation]) => operation === 'remove'), [
    ['remove', 'public-1'],
    ['remove', 'public-2'],
  ]);
});

test('archives one device without revoking its sibling device', () => {
  const { service, peerStore, privateKeys, awg } = serviceFixture();
  const created = service.createUser({ userName: 'Alice', devices: ['iPhone', 'Laptop'] });
  awg.operations.length = 0;

  const archived = service.archiveDevice(created.devices[0].deviceId);

  assert.equal(archived.deviceName, 'iPhone');
  assert.ok(archived.archivedAt);
  const devices = peerStore.load().filter((peer) => peer.userNumber === 22);
  assert.equal(devices[0].enabled, false);
  assert.equal(devices[1].enabled, true);
  assert.deepEqual(privateKeys.load(), {
    'legacy-public-1': 'existing-private',
    'public-2': 'private-2',
  });
  assert.deepEqual(awg.operations.filter(([operation]) => operation === 'remove'), [
    ['remove', 'public-1'],
  ]);
});

test('archiving an already disabled device still removes its private key', () => {
  const { service, peerStore, privateKeys, awg } = serviceFixture();
  const created = service.createUser({ userName: 'Alice', devices: ['iPhone'] });
  const stored = peerStore.load();
  stored.at(-1).enabled = false;
  peerStore.save(stored);
  awg.operations.length = 0;

  service.archiveDevice(created.devices[0].deviceId);

  assert.deepEqual(privateKeys.load(), { 'legacy-public-1': 'existing-private' });
  assert.deepEqual(awg.operations.filter(([operation]) => operation === 'remove'), []);
});

test('rejects duplicate device names before changing live state', () => {
  const { service, awg } = serviceFixture();

  assert.throws(
    () => service.createUser({ userName: 'Alice', devices: ['Phone', 'phone'] }),
    /device names must be unique/
  );
  assert.deepEqual(awg.operations, []);
});
