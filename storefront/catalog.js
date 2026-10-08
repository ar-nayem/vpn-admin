const GIB = 1024 ** 3;

const PACKAGES = Object.freeze({
  basic: Object.freeze({ name: 'Basic', priceCny: 5, quotaGb: 60, downKbps: 5120, upKbps: 5120 }),
  premium: Object.freeze({ name: 'Premium', priceCny: 10, quotaGb: 120, downKbps: 0, upKbps: 0 }),
  pro: Object.freeze({ name: 'Pro', priceCny: 15, quotaGb: 200, downKbps: 0, upKbps: 0 }),
});

function addCalendarMonths(value, months) {
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) throw new TypeError('activation date is invalid');

  const destination = new Date(Date.UTC(
    source.getUTCFullYear(),
    source.getUTCMonth() + months,
    1,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds()
  ));
  const finalDay = new Date(Date.UTC(
    destination.getUTCFullYear(),
    destination.getUTCMonth() + 1,
    0
  )).getUTCDate();
  destination.setUTCDate(Math.min(source.getUTCDate(), finalDay));
  return destination;
}

function calculateEntitlement(planId, months, activatedAt = new Date()) {
  const plan = PACKAGES[planId];
  if (!plan) throw new RangeError('plan is invalid');
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new RangeError('months must be an integer between 1 and 24');
  }

  return {
    planId,
    planName: plan.name,
    months,
    priceCny: plan.priceCny * months,
    quotaBytes: plan.quotaGb * months * GIB,
    downKbps: plan.downKbps,
    upKbps: plan.upKbps,
    expiresAt: addCalendarMonths(activatedAt, months).toISOString(),
  };
}

module.exports = { GIB, PACKAGES, calculateEntitlement };
