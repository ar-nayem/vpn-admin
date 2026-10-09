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
  assert.deepEqual(model.normalizeUsagePoints([{ uploadKbps: 8, downloadKbps: 4 }], 200, 100), {
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
    transferred: '2.0 GB', uploadPeak: '5 Mbps', downloadPeak: '10 Mbps', connected: '1 hr 5 min',
  });
  assert.deepEqual(model.formatUsageSummary({}), {
    transferred: '0 MB', uploadPeak: '0 Mbps', downloadPeak: '0 Mbps', connected: '0 min',
  });
  assert.deepEqual(model.formatUsageSummary({ uploadedBytes: Infinity, downloadedBytes: '<script>', peakUploadKbps: NaN, peakDownloadKbps: -1, connectedMinutes: '1h' }), {
    transferred: '0 MB', uploadPeak: '0 Mbps', downloadPeak: '0 Mbps', connected: '0 min',
  });
});
