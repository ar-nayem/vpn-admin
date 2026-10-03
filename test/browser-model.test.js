const test = require('node:test');
const assert = require('node:assert/strict');

const {
  groupPeerSnapshots,
  buildCreateUserPayload,
  buildArchiveUserPayload,
  buildArchiveDevicePayload,
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
