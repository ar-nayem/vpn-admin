const crypto = require('crypto');
const { GIB } = require('../catalog');
const { normalizeEmail } = require('./auth');

class TrialError extends Error {
  constructor(message, code) { super(message); this.name = 'TrialError'; this.code = code; }
}

function clean(value, label) {
  const result = String(value || '').trim();
  if (!result || result.length > 80) throw new TypeError(`${label} is invalid`);
  return result;
}

function createTrialService({ db, customers, profiles, verification, provisioning, notifications = {}, now = () => new Date(), randomUUID = crypto.randomUUID }) {
  const consumeTrial = db.prepare(`
    UPDATE customers SET trial_consumed_at = @timestamp, updated_at = @timestamp
    WHERE id = @customerId AND trial_consumed_at IS NULL
  `);
  const releaseTrial = db.prepare(`
    UPDATE customers SET trial_consumed_at = NULL, updated_at = @timestamp
    WHERE id = @customerId AND trial_consumed_at = @reservedAt
  `);
  const reserve = db.transaction((input) => {
    let customer = customers.findByNormalizedEmail(input.normalizedEmail);
    if (!verification.consumeGrant({ email: input.normalizedEmail, purpose: 'trial', grant: input.verificationGrant })) {
      throw new TrialError('email verification is invalid or expired', 'VERIFICATION_REQUIRED');
    }
    if (!customer) {
      customer = customers.create({
        id: randomUUID(), email: input.normalizedEmail, normalizedEmail: input.normalizedEmail,
        name: input.name, passwordHash: null, verifiedAt: input.timestamp, createdAt: input.timestamp,
      });
    }
    if (consumeTrial.run({ customerId: customer.id, timestamp: input.timestamp }).changes !== 1) {
      throw new TrialError('the free trial has already been used for this email', 'TRIAL_ALREADY_USED');
    }
    const profile = profiles.create({
      id: randomUUID(), customerId: customer.id, codeName: input.codeName,
      normalizedCodeName: input.codeName.toLocaleLowerCase(), trialKey: input.normalizedEmail,
      state: 'pending', planId: 'trial', planName: 'Free trial', quotaBytes: GIB,
      downKbps: 5120, upKbps: 5120, expiresAt: null, createdAt: input.timestamp,
    });
    return { customer, profile };
  });
  const rollback = db.transaction(({ profileId, customerId, reservedAt, timestamp }) => {
    profiles.deletePending(profileId);
    releaseTrial.run({ customerId, reservedAt, timestamp });
  });

  return {
    async startTrial({ name, email, codeName, verificationGrant }) {
      const timestamp = now().toISOString();
      const normalizedEmail = normalizeEmail(email);
      const reservation = reserve({
        name: clean(name, 'name'), normalizedEmail, codeName: clean(codeName, 'code name'),
        verificationGrant, timestamp,
      });
      let provisioned;
      try {
        provisioned = await provisioning.createTrial({
          customerRef: reservation.customer.id,
          customerName: reservation.customer.name,
          codeName: reservation.profile.code_name,
          entitlement: { planId: 'trial', planName: 'Free trial', quotaBytes: GIB, downKbps: 5120, upKbps: 5120, expiresAt: null },
        });
      } catch {
        rollback({ profileId: reservation.profile.id, customerId: reservation.customer.id, reservedAt: timestamp, timestamp: now().toISOString() });
        throw new TrialError('the trial could not be activated; please try again', 'TRIAL_PROVISIONING_FAILED');
      }
      if (!profiles.activate({
        id: reservation.profile.id, deviceId: provisioned.deviceId, pubkey: provisioned.pubkey,
        ip: provisioned.ip, updatedAt: now().toISOString(),
      })) {
        throw new TrialError('the activated trial could not be recorded', 'TRIAL_RECORDING_FAILED');
      }
      const activeProfile = profiles.findById(reservation.profile.id);
      if (notifications.trialActivated) {
        try { await notifications.trialActivated({ customer: reservation.customer, profile: activeProfile }); } catch { /* delivery retries separately */ }
      }
      return activeProfile;
    },
  };
}

module.exports = { createTrialService, TrialError };
