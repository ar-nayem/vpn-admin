const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateEntitlement } = require('../storefront/catalog');

test('calculates Basic entitlement for three months', () => {
  assert.deepEqual(
    calculateEntitlement('basic', 3, new Date('2026-10-08T00:00:00.000Z')),
    {
      planId: 'basic',
      planName: 'Basic',
      months: 3,
      priceCny: 15,
      quotaBytes: 180 * 1024 ** 3,
      downKbps: 5120,
      upKbps: 5120,
      expiresAt: '2027-01-08T00:00:00.000Z',
    }
  );
});

test('calculates Premium and Pro without speed caps', () => {
  const premium = calculateEntitlement('premium', 2, new Date('2026-10-08T00:00:00.000Z'));
  const pro = calculateEntitlement('pro', 1, new Date('2026-10-08T00:00:00.000Z'));

  assert.equal(premium.priceCny, 20);
  assert.equal(premium.quotaBytes, 240 * 1024 ** 3);
  assert.equal(premium.downKbps, 0);
  assert.equal(premium.upKbps, 0);
  assert.equal(pro.priceCny, 15);
  assert.equal(pro.quotaBytes, 200 * 1024 ** 3);
  assert.equal(pro.downKbps, 0);
  assert.equal(pro.upKbps, 0);
});

test('rejects unknown plans and invalid month counts', () => {
  assert.throws(() => calculateEntitlement('unknown', 1, new Date()), /plan/i);
  assert.throws(() => calculateEntitlement('basic', 0, new Date()), /months/i);
  assert.throws(() => calculateEntitlement('basic', 25, new Date()), /months/i);
  assert.throws(() => calculateEntitlement('basic', 1.5, new Date()), /months/i);
});

test('clamps calendar-month expiry to the destination month', () => {
  const result = calculateEntitlement('basic', 1, new Date('2027-01-31T12:00:00.000Z'));
  assert.equal(result.expiresAt, '2027-02-28T12:00:00.000Z');
});
