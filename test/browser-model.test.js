const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  groupPeerSnapshots,
  buildCreateUserPayload,
  buildArchiveUserPayload,
  buildArchiveDevicePayload,
  filterPeersForView,
  usageRanges,
  selectAnalyticsProfiles,
  normalizeUsagePoints,
  createUsagePath,
} = require('../public/user-view');

test('admin workspace keeps its management, account, and confirmation actions available', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  const app = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  for (const label of ['VPN users', 'Storefront customers', 'Orders', 'Usage history', 'Payment QR', 'Recently deleted', 'Password', 'Sign out', 'Add user', 'Add another device']) {
    assert.ok(html.includes(label), `missing admin action or workspace: ${label}`);
  }
  for (const feature of ['down-speed', 'up-speed', 'quota-text', 'expiry-text', 'download', 'archive-user', 'archive-device', 'reset-usage']) {
    assert.ok(app.includes(`data-role="${feature}"`), `missing peer management control: ${feature}`);
  }
  for (const endpoint of ['/api/peers/', '/api/users/', '/api/storefront/orders', '/api/storefront/payment-qr']) {
    assert.ok(app.includes(endpoint), `missing existing admin endpoint: ${endpoint}`);
  }
  assert.match(app, /Delete User .*revokes all of this user's devices/);
  assert.match(app, /Delete Device .*? VPN connection/);
});

test('admin usage workspace accepts the six supported ranges and only listed eligible profiles', () => {
  assert.deepEqual(usageRanges, ['1h', '1d', '7d', '10d', '30d', 'lifetime']);
  const profiles = selectAnalyticsProfiles([
    { id: 'new-phone', codeName: 'Phone', customerName: 'Owner', customerEmail: 'owner@example.com' },
    { id: 'legacy', codeName: 'Legacy', customerName: 'Owner', analyticsEnabled: false },
    { id: '', codeName: 'Invalid' },
  ]);
  assert.deepEqual(profiles, [{ id: 'new-phone', codeName: 'Phone', customerName: 'Owner', customerEmail: 'owner@example.com' }]);
});

test('admin SVG helpers preserve real timestamps and reject malformed paths', () => {
  const normalized = normalizeUsagePoints([
    { timestamp: '2026-10-09T00:00:00.000Z', uploadKbps: 2, downloadKbps: 4 },
    { timestamp: '2026-10-09T01:00:00.000Z', uploadKbps: 4, downloadKbps: 2 },
    { timestamp: '2026-10-09T10:00:00.000Z', uploadKbps: 1, downloadKbps: 8 },
  ], 100, 50);
  assert.deepEqual(normalized.points.map((point) => point.x), [0, 10, 100]);
  assert.equal(createUsagePath(normalized.points, 'uploadY'), 'M 0 37.5 L 10 25 L 100 43.75');
  assert.equal(createUsagePath([{ x: Infinity, uploadY: 1 }], 'uploadY'), '');
});

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
