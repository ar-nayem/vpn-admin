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
