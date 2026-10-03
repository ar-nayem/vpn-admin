const test = require('node:test');
const assert = require('node:assert/strict');

const {
  projectPeers,
  nextUserNumber,
  groupUsers,
  allocateIp,
} = require('../lib/user-model');

test('21 legacy peers project to Users 1-21 without mutation', () => {
  const peers = Array.from({ length: 21 }, (_, i) => ({
    name: `Peer ${i + 1}`,
    pubkey: `key-${i + 1}`,
    ip: `10.66.67.${i + 2}`,
    enabled: true,
  }));
  const before = JSON.stringify(peers);

  const projected = projectPeers(peers);

  assert.equal(projected[0].userNumber, 1);
  assert.equal(projected[20].userNumber, 21);
  assert.equal(projected[0].userName, 'Peer 1');
  assert.equal(projected[0].deviceName, 'Existing device');
  assert.equal(JSON.stringify(peers), before);
});

test('next account after 21 legacy peers is User 22', () => {
  const peers = Array.from({ length: 21 }, (_, i) => ({
    pubkey: `key-${i + 1}`,
    ip: `10.66.67.${i + 2}`,
  }));

  assert.equal(nextUserNumber(peers), 22);
});

test('archived account numbers are never reused', () => {
  const peers = [{ userNumber: 22, archivedAt: '2026-10-03T00:00:00.000Z' }];

  assert.equal(nextUserNumber(peers), 23);
});

test('IP allocation skips addresses already in use', () => {
  const peers = [{ ip: '10.66.67.2' }, { ip: '10.66.67.4' }];

  assert.equal(allocateIp(peers, '10.66.67'), '10.66.67.3');
});

test('users group devices and keep archived devices after active devices', () => {
  const peers = [
    { userNumber: 22, userName: 'Alice', deviceId: 'archived', deviceName: 'Old phone', archivedAt: '2026-10-03T00:00:00.000Z' },
    { userNumber: 22, userName: 'Alice', deviceId: 'active', deviceName: 'Laptop' },
  ];

  const users = groupUsers(peers);

  assert.equal(users.length, 1);
  assert.equal(users[0].userNumber, 22);
  assert.deepEqual(users[0].devices.map((device) => device.deviceId), ['active', 'archived']);
});

test('IP allocation reports exhausted address space', () => {
  const peers = Array.from({ length: 253 }, (_, i) => ({ ip: `10.66.67.${i + 2}` }));

  assert.throws(() => allocateIp(peers, '10.66.67'), /no client IP addresses available/);
});
