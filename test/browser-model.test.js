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
  transitionWorkspace,
  reconcileAnalyticsSelection,
  formatHistorySummary,
  afterSuccessfulProvisioning,
  formatUsageChartContext,
  buildUsageChartModel,
  findNearestUsagePoint,
  getNavScrollTarget,
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

test('returning from recently deleted to VPN users selects the active view', () => {
  assert.deepEqual(transitionWorkspace({ workspace: 'vpn-users', view: 'deleted' }, 'vpn-users'), {
    workspace: 'vpn-users', view: 'active',
  });
  assert.deepEqual(transitionWorkspace({ workspace: 'vpn-users', view: 'active' }, 'recently-deleted'), {
    workspace: 'vpn-users', view: 'deleted',
  });
});

test('profile discovery refresh includes newly provisioned profiles and preserves valid selection', () => {
  const previous = [
    { id: 'phone', codeName: 'Phone', customerName: 'Owner', customerEmail: 'owner@example.com' },
  ];
  const refreshed = reconcileAnalyticsSelection([
    ...previous,
    { id: 'laptop', codeName: 'Laptop', customerName: 'Owner', customerEmail: 'owner@example.com' },
    { id: 'legacy', codeName: 'Legacy', customerName: 'Owner', customerEmail: 'owner@example.com', analyticsEnabled: false },
  ], 'owner@example.com', 'phone');

  assert.deepEqual(refreshed.profiles.map((profile) => profile.id), ['phone', 'laptop']);
  assert.equal(refreshed.customerKey, 'owner@example.com');
  assert.equal(refreshed.profileId, 'phone');
});

test('successful provisioning refreshes profile discovery while failed provisioning does not', async () => {
  let profiles = [];
  let refreshes = 0;
  const result = await afterSuccessfulProvisioning(
    async () => ({ state: 'approved' }),
    async () => { refreshes += 1; profiles = [{ id: 'new-profile' }]; },
  );
  assert.deepEqual(result, { state: 'approved' });
  assert.equal(refreshes, 1);
  assert.deepEqual(profiles, [{ id: 'new-profile' }]);
  await assert.rejects(afterSuccessfulProvisioning(async () => { throw new Error('failed'); }, async () => { refreshes += 1; }));
  assert.equal(refreshes, 1);
});

test('history summary maps invalid and unsafe values to finite zero defaults', () => {
  assert.deepEqual(formatHistorySummary(null), {
    transferred: '0.0 B', uploadPeak: '0 Kbps', downloadPeak: '0 Kbps', connected: '0 min',
  });
  assert.deepEqual(formatHistorySummary({
    uploadedBytes: -10, downloadedBytes: Infinity, peakUploadKbps: NaN,
    peakDownloadKbps: 'not a number', connectedMinutes: -5,
  }), {
    transferred: '0.0 B', uploadPeak: '0 Kbps', downloadPeak: '0 Kbps', connected: '0 min',
  });
  assert.deepEqual(formatHistorySummary({ uploadedBytes: Number.MAX_VALUE, downloadedBytes: Number.MAX_VALUE }), {
    transferred: '8192.0 TB', uploadPeak: '0 Kbps', downloadPeak: '0 Kbps', connected: '0 min',
  });
});

test('admin chart context labels real timestamps and a safe speed scale', () => {
  const context = formatUsageChartContext([
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 512, downloadKbps: 2048 },
    { timestamp: '2026-01-01T00:30:00.000Z', uploadKbps: 1024, downloadKbps: 768 },
    { timestamp: '2026-01-01T01:00:00.000Z', uploadKbps: 256, downloadKbps: 512 },
  ], '1h', 'UTC');
  assert.deepEqual(context.timeLabels, ['00:00', '00:30', '01:00']);
  assert.equal(context.scaleLabel, 'Max 2.0 Mbps · Baseline 0 Kbps');
  assert.deepEqual(formatUsageChartContext([], '1d', 'Bad/Timezone').timeLabels, ['24 hr ago', '12 hr ago', 'Now']);
  assert.equal(formatUsageChartContext([{ uploadKbps: Infinity, downloadKbps: -1 }], '1d').scaleLabel, 'Max 0 Kbps · Baseline 0 Kbps');
  assert.equal(formatUsageChartContext([{ uploadKbps: 0.4, downloadKbps: 0 }], '1d').scaleLabel, 'Max <1 Kbps · Baseline 0 Kbps');
  assert.deepEqual(formatUsageChartContext([
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 1 },
    { timestamp: 'invalid', uploadKbps: 2 },
  ], '30d').timeLabels, ['30 days ago', '15 days ago', 'Now']);
  assert.deepEqual(formatUsageChartContext([
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 1 },
    { timestamp: '2026-01-01T01:00:00.000Z', uploadKbps: 2 },
  ], '1h', 'Bad/Timezone').timeLabels, ['00:00', '00:30', '01:00']);
});

test('admin market chart exposes matching time and speed axes for inspection', () => {
  const chart = buildUsageChartModel([
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 512, downloadKbps: 2048 },
    { timestamp: '2026-01-01T00:30:00.000Z', uploadKbps: 1024, downloadKbps: 768 },
    { timestamp: '2026-01-01T01:00:00.000Z', uploadKbps: 256, downloadKbps: 512 },
  ], '1h', 'UTC', 600, 240);
  assert.deepEqual(chart.bounds, { left: 64, right: 584, top: 16, bottom: 208 });
  assert.deepEqual(chart.yTicks.map((tick) => tick.label), ['2 Mbps', '1.5 Mbps', '1 Mbps', '512 Kbps', '0 Kbps']);
  assert.deepEqual(chart.xTicks.map((tick) => tick.label), ['00:00', '00:15', '00:30', '00:45', '01:00']);
  assert.equal(findNearestUsagePoint(chart.points, 500), chart.points[2]);
});

test('admin usage workspace exposes market chart axes and pointer inspection controls', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  const app = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  for (const id of ['usage-grid', 'usage-y-axis', 'usage-x-axis', 'usage-crosshair', 'usage-hit-area', 'usage-tooltip']) {
    assert.ok(html.includes(`id="${id}"`), `missing admin chart element ${id}`);
  }
  assert.match(app, /pointermove/);
  assert.match(app, /findNearestUsagePoint/);
});

test('admin chart assets are versioned so browsers cannot reuse the incomplete chart', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  assert.match(html, /\/admin\/style\.css\?v=[a-z0-9-]+/i);
  assert.match(html, /\/admin\/app\.js\?v=[a-z0-9-]+/i);
});

test('admin chart labels the timestamp when tracking has only one measurement', () => {
  const chart = buildUsageChartModel([
    { timestamp: '2026-10-10T06:15:00.000Z', uploadKbps: 216, downloadKbps: 981 },
  ], '7d', 'UTC', 600, 240);
  assert.deepEqual(chart.xTicks.map((tick) => tick.label), ['10 Oct']);
  assert.equal(chart.xTicks[0].x, chart.points[0].x);
});

test('admin navigation scroll target reveals only clipped active items inside its own scroller', () => {
  assert.equal(getNavScrollTarget({ scrollLeft: 0, scrollWidth: 800, clientWidth: 320, containerLeft: 0, containerRight: 320, itemLeft: 340, itemRight: 420 }), 100);
  assert.equal(getNavScrollTarget({ scrollLeft: 100, scrollWidth: 800, clientWidth: 320, containerLeft: 0, containerRight: 320, itemLeft: -50, itemRight: 40 }), 50);
  assert.equal(getNavScrollTarget({ scrollLeft: 0, scrollWidth: 800, clientWidth: 320, containerLeft: 0, containerRight: 320, itemLeft: 20, itemRight: 80 }), 0);
  assert.equal(getNavScrollTarget({ scrollLeft: 470, scrollWidth: 800, clientWidth: 320, containerLeft: 0, containerRight: 320, itemLeft: 400, itemRight: 500 }), 480);
  assert.equal(getNavScrollTarget({ scrollLeft: 0, scrollWidth: 800, clientWidth: 320, containerLeft: 0, containerRight: 320, itemLeft: 310, itemRight: 340 }), 20);
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
