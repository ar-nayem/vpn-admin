const test = require('node:test');
const assert = require('node:assert/strict');

const { createProvisioningService } = require('../lib/provisioning');

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
  let id = 0;
  const service = createProvisioningService({
    peerStore,
    keyStore,
    awg,
    clientPrefix: '10.66.67',
    confPath: '/fake/awg0.conf',
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    randomUUID: () => `device-${++id}`,
  });

  const user = service.createUser({ userName: 'Alice', devices: ['Phone'] });
  const added = service.addDevice(user.userNumber, { deviceName: 'Laptop' });
  service.archiveDevice(added.deviceId);
  service.archiveUser(user.userNumber);

  const allowed = new Set([
    'generate-key',
    'add-peer',
    'remove-peer',
    'read-config',
    'write-config',
    'persist-config',
  ]);
  assert.deepEqual([...new Set(operations.filter((operation) => !allowed.has(operation)))], []);
});
