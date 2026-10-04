const test = require('node:test');
const assert = require('node:assert/strict');

const {
  groupPeerSnapshots,
  buildCreateUserPayload,
  buildArchiveUserPayload,
  buildArchiveDevicePayload,
  filterPeersForView,
} = require('../public/user-view');

test('groups multiple devices under numbered users with archived devices last', () => {
  const groups = groupPeerSnapshots([
    { userNumber: 22, userName: 'Alice', deviceId: 'old', deviceName: 'Old phone', archivedAt: '2026-10-03T00:00:00.000Z' },
    { userNumber: 1, userName: 'Peer 1', deviceId: 'legacy-1', deviceName: 'Existing device', archivedAt: null },
    { userNumber: 22, userName: 'Alice', deviceId: 'laptop', deviceName: 'Laptop', archivedAt: null },
  ]);

  assert.deepEqual(groups.map((group) => group.userNumber), [1, 22]);
  assert.deepEqual(groups[1].devices.map((device) => device.deviceId), ['laptop', 'old']);
});

test('builds trimmed user creation payload without private data', () => {
  assert.deepEqual(buildCreateUserPayload(' Alice ', [' iPhone ', '', ' Laptop ']), {
    userName: 'Alice',
    devices: ['iPhone', 'Laptop'],
  });
});

test('builds exact archive confirmation payloads', () => {
  assert.deepEqual(buildArchiveUserPayload(22), { confirmUserNumber: 22 });
  assert.deepEqual(buildArchiveDevicePayload('device-22'), { confirmDeviceId: 'device-22' });
});

test('active user view excludes archived devices', () => {
  const peers = [
    { pubkey: 'active', archivedAt: null },
    { pubkey: 'deleted', archivedAt: '2026-10-04T01:00:00.000Z' },
  ];

  assert.deepEqual(filterPeersForView(peers, 'active').map((peer) => peer.pubkey), ['active']);
});

test('deleted user view shows newest archived devices first', () => {
  const peers = [
    { pubkey: 'active', archivedAt: null },
    { pubkey: 'older', archivedAt: '2026-10-03T01:00:00.000Z' },
    { pubkey: 'newer', archivedAt: '2026-10-04T01:00:00.000Z' },
  ];

  assert.deepEqual(filterPeersForView(peers, 'deleted').map((peer) => peer.pubkey), ['newer', 'older']);
});
