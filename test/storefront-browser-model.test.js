const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../storefront/public/model');

test('calculates exact multi-month package summaries', () => {
  assert.deepEqual(model.planSummary({ priceCny: 5, quotaGb: 60, downKbps: 5120, upKbps: 5120 }, 3), { priceCny: 15, quotaGb: 180, months: 3, speed: '5 Mbps up & down' });
  assert.equal(model.speedLabel(0, 0), 'Unlimited speed');
});

test('requires proof and an available QR method before checkout submission', () => {
  assert.equal(model.canSubmitOrder({ proof: {}, paymentMethod: 'wechat', qrAvailability: { wechat: true } }), true);
  assert.equal(model.canSubmitOrder({ proof: null, paymentMethod: 'wechat', qrAvailability: { wechat: true } }), false);
  assert.equal(model.paymentAvailable({ available: false }), false);
});

test('builds clear dashboard usage, expiry, status, and action copy', () => {
  const trial = model.profileView({ planId: 'trial', quotaBytes: 1024 ** 3, usedBytes: 1024 ** 3, remainingBytes: 0, expiresAt: null, downKbps: 5120, upKbps: 5120 });
  assert.equal(trial.exhausted, true);
  assert.equal(trial.expiryLabel, 'No time expiry');
  assert.equal(trial.action, 'Upgrade');
  assert.equal(trial.speedLabel, '5 Mbps up & down');
  const paid = model.profileView({ planId: 'pro', quotaBytes: 200 * 1024 ** 3, usedBytes: 1, remainingBytes: 199 * 1024 ** 3, expiresAt: '2026-11-08T00:00:00.000Z', downKbps: 0, upKbps: 0 });
  assert.equal(paid.action, 'Renew');
  assert.equal(paid.speedLabel, 'Unlimited speed');
});

test('validates the six supported usage history ranges', () => {
  for (const range of ['1h', '1d', '7d', '10d', '30d', 'lifetime']) {
    assert.equal(model.isUsageRange(range), true, `${range} should be supported`);
  }
  for (const range of ['', '2d', '__proto__', null]) assert.equal(model.isUsageRange(range), false);
});

test('normalizes empty, single, multiple, zero, and hostile chart history', () => {
  assert.deepEqual(model.normalizeUsagePoints([]), { points: [], maxKbps: 0 });
  assert.deepEqual(model.normalizeUsagePoints([{ timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 8, downloadKbps: 4 }], 200, 100), {
    points: [{ x: 100, uploadY: 0, downloadY: 50 }], maxKbps: 8,
  });
  const multiple = model.normalizeUsagePoints([
    { uploadKbps: 0, downloadKbps: 5 },
    { uploadKbps: 10, downloadKbps: 0 },
  ], 100, 50);
  assert.deepEqual(multiple, { points: [{ x: 0, uploadY: 50, downloadY: 25 }, { x: 100, uploadY: 0, downloadY: 50 }], maxKbps: 10 });
  assert.deepEqual(model.normalizeUsagePoints([{ uploadKbps: 0, downloadKbps: 0 }], 100, 50), {
    points: [{ x: 50, uploadY: 50, downloadY: 50 }], maxKbps: 0,
  });
  assert.deepEqual(model.normalizeUsagePoints([
    { uploadKbps: 'NaN', downloadKbps: Infinity },
    { uploadKbps: '<svg onload=alert(1)>', downloadKbps: -4 },
  ], 100, 50), {
    points: [{ x: 0, uploadY: 50, downloadY: 50 }, { x: 100, uploadY: 50, downloadY: 50 }], maxKbps: 0,
  });
});

test('positions usage history proportionally by chronological timestamps', () => {
  const history = [
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 1, downloadKbps: 0 },
    { timestamp: '2026-01-01T00:01:00.000Z', uploadKbps: 2, downloadKbps: 0 },
    { timestamp: '2026-01-01T00:10:00.000Z', uploadKbps: 3, downloadKbps: 0 },
  ];
  assert.deepEqual(model.normalizeUsagePoints(history, 100, 50).points.map((point) => point.x), [0, 10, 100]);
});

test('uses evenly spaced positions when timestamps are invalid or equal', () => {
  const values = [{ uploadKbps: 1 }, { uploadKbps: 2 }, { uploadKbps: 3 }];
  const invalid = values.map((point, index) => ({ ...point, timestamp: ['2026-01-01T00:00:00Z', 'not-a-time', '2026-01-01T00:10:00Z'][index] }));
  const equal = values.map((point) => ({ ...point, timestamp: '2026-01-01T00:00:00Z' }));
  assert.deepEqual(model.normalizeUsagePoints(invalid, 100, 50).points.map((point) => point.x), [0, 50, 100]);
  assert.deepEqual(model.normalizeUsagePoints(equal, 100, 50).points.map((point) => point.x), [0, 50, 100]);
});

test('creates safe SVG paths from normalized points', () => {
  assert.equal(model.createUsagePath([], 'uploadY'), '');
  assert.equal(model.createUsagePath([{ x: 12, uploadY: 8 }], 'uploadY'), 'M 12 8');
  assert.equal(model.createUsagePath([{ x: 0, uploadY: 10 }, { x: 20, uploadY: 2 }], 'uploadY'), 'M 0 10 L 20 2');
  assert.equal(model.createUsagePath([{ x: '1 L 2', uploadY: Infinity }], 'uploadY'), '');
  assert.equal(model.createUsagePath([{ x: 1, downloadY: 2 }], 'onload'), '');
});

test('formats usage totals and connected time safely', () => {
  assert.deepEqual(model.formatUsageSummary({
    uploadedBytes: 1024 ** 2,
    downloadedBytes: 2 * 1024 ** 3,
    peakUploadKbps: 5120,
    peakDownloadKbps: 10240,
    connectedMinutes: 65,
  }), {
    transferred: '2.0 GB', uploadPeak: '5.0 Mbps', downloadPeak: '10.0 Mbps', connected: '1 hr 5 min',
  });
  assert.deepEqual(model.formatUsageSummary({}), {
    transferred: '0 MB', uploadPeak: '0 Kbps', downloadPeak: '0 Kbps', connected: '0 min',
  });
  assert.deepEqual(model.formatUsageSummary({ uploadedBytes: Infinity, downloadedBytes: '<script>', peakUploadKbps: NaN, peakDownloadKbps: -1, connectedMinutes: '1h' }), {
    transferred: '0 MB', uploadPeak: '0 Kbps', downloadPeak: '0 Kbps', connected: '0 min',
  });
});

test('peak summaries preserve sub-Mbps speeds and match administrator precision', () => {
  const admin = require('../public/user-view');
  for (const [value, expected] of [[0, '0 Kbps'], [400, '400 Kbps'], [1023, '1023 Kbps'], [1024, '1.0 Mbps'], [1536, '1.5 Mbps'], [5120, '5.0 Mbps']]) {
    const summary = { peakUploadKbps: value, peakDownloadKbps: value };
    const formatted = model.formatUsageSummary(summary);
    assert.equal(formatted.uploadPeak, expected);
    assert.equal(formatted.downloadPeak, expected);
    assert.equal(formatted.uploadPeak, admin.formatHistorySummary(summary).uploadPeak);
  }
});

test('customer chart context labels sampled times and a safe max-speed baseline', () => {
  const context = model.formatUsageChartContext([
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 512, downloadKbps: 2048 },
    { timestamp: '2026-01-01T00:30:00.000Z', uploadKbps: 1024, downloadKbps: 768 },
    { timestamp: '2026-01-01T01:00:00.000Z', uploadKbps: 256, downloadKbps: 512 },
  ], '1h', 'UTC');
  assert.deepEqual(context.timeLabels, ['00:00', '00:30', '01:00']);
  assert.equal(context.scaleLabel, 'Max 2.0 Mbps · Baseline 0 Kbps');
  assert.deepEqual(model.formatUsageChartContext([], 'lifetime').timeLabels, ['Start', 'Midpoint', 'Now']);
  assert.equal(model.formatUsageChartContext([{ uploadKbps: NaN, downloadKbps: -4 }], '1d').scaleLabel, 'Max 0 Kbps · Baseline 0 Kbps');
  assert.equal(model.formatUsageChartContext([{ uploadKbps: 0.4, downloadKbps: 0 }], '1d').scaleLabel, 'Max <1 Kbps · Baseline 0 Kbps');
  assert.deepEqual(model.formatUsageChartContext([
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 1 },
    { timestamp: 'invalid', uploadKbps: 2 },
  ], '30d').timeLabels, ['30 days ago', '15 days ago', 'Now']);
});

test('builds a market-style chart with explicit axes and timestamped inspection points', () => {
  const history = [
    { timestamp: '2026-01-01T00:00:00.000Z', uploadKbps: 512, downloadKbps: 2048 },
    { timestamp: '2026-01-01T00:30:00.000Z', uploadKbps: 1024, downloadKbps: 768 },
    { timestamp: '2026-01-01T01:00:00.000Z', uploadKbps: 256, downloadKbps: 512 },
  ];
  const chart = model.buildUsageChartModel(history, '1h', 'UTC', 600, 240);
  assert.deepEqual(chart.bounds, { left: 64, right: 584, top: 16, bottom: 208 });
  assert.deepEqual(chart.yTicks.map((tick) => tick.label), ['2 Mbps', '1.5 Mbps', '1 Mbps', '512 Kbps', '0 Kbps']);
  assert.deepEqual(chart.xTicks.map((tick) => tick.label), ['00:00', '00:15', '00:30', '00:45', '01:00']);
  assert.deepEqual(chart.points.map((point) => point.x), [64, 324, 584]);
  assert.equal(chart.points[0].timestamp, history[0].timestamp);
  assert.equal(chart.points[0].uploadKbps, 512);
  assert.equal(chart.points[0].downloadKbps, 2048);
  assert.equal(model.findNearestUsagePoint(chart.points, 300), chart.points[1]);
  assert.equal(model.findNearestUsagePoint([], 100), null);
});

test('customer dashboard exposes market chart axes and pointer inspection controls', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require.resolve('../storefront/public/dashboard.html'), 'utf8');
  const script = fs.readFileSync(require.resolve('../storefront/public/dashboard.js'), 'utf8');
  for (const id of ['usage-grid', 'usage-y-axis', 'usage-x-axis', 'usage-crosshair', 'usage-hit-area', 'usage-tooltip']) {
    assert.ok(html.includes(`id="${id}"`), `missing customer chart element ${id}`);
  }
  assert.match(script, /pointermove/);
  assert.match(script, /findNearestUsagePoint/);
});
