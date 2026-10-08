const crypto = require('crypto');
const { calculateEntitlement } = require('../catalog');
const { normalizeEmail } = require('./auth');

class OrderError extends Error {
  constructor(message, code) { super(message); this.name = 'OrderError'; this.code = code; }
}

function createOrderService({ db, orders, profiles, verification, proofStorage, now = () => new Date(), randomUUID = crypto.randomUUID }) {
  function assertOwnership({ customerId, guestGrant, profile }) {
    if (customerId) {
      if (profile.customer_id !== customerId) throw new OrderError('profile was not found', 'PROFILE_NOT_FOUND');
      return customerId;
    }
    if (!guestGrant) throw new OrderError('profile verification is required', 'VERIFICATION_REQUIRED');
    const normalizedEmail = normalizeEmail(guestGrant.email);
    if (!verification.consumeGrant({ email: normalizedEmail, purpose: 'tracking', grant: guestGrant.grant })) {
      throw new OrderError('profile verification is invalid or expired', 'VERIFICATION_REQUIRED');
    }
    const owned = profiles.findByNormalizedEmail(normalizedEmail).some((candidate) => candidate.id === profile.id);
    if (!owned) throw new OrderError('profile was not found', 'PROFILE_NOT_FOUND');
    return profile.customer_id;
  }

  return {
    async submitOrder(input = {}) {
      if (!input.proof) throw new OrderError('payment proof is required', 'PROOF_REQUIRED');
      if (!['wechat', 'alipay'].includes(input.paymentMethod)) throw new OrderError('payment method is invalid', 'PAYMENT_METHOD_INVALID');
      const profile = profiles.findById(String(input.profileId || ''));
      if (!profile) throw new OrderError('profile was not found', 'PROFILE_NOT_FOUND');
      const customerId = assertOwnership({ customerId: input.customerId, guestGrant: input.guestGrant, profile });
      let entitlement;
      try { entitlement = calculateEntitlement(input.planId, Number(input.months), now()); }
      catch { throw new OrderError('package or month count is invalid', 'PACKAGE_INVALID'); }
      const stored = await proofStorage.store(input.proof);
      try {
        return orders.create({
          id: randomUUID(), customerId, profileId: profile.id, state: 'pending',
          planId: entitlement.planId, planName: entitlement.planName, months: entitlement.months,
          priceCny: entitlement.priceCny, quotaBytes: entitlement.quotaBytes,
          downKbps: entitlement.downKbps, upKbps: entitlement.upKbps, expiresAt: entitlement.expiresAt,
          paymentMethod: input.paymentMethod, proofFilename: stored.filename, createdAt: now().toISOString(),
        });
      } catch (cause) {
        await proofStorage.remove(stored.filename);
        if (cause && cause.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new OrderError('this profile already has an order awaiting review', 'ORDER_ALREADY_PENDING');
        }
        throw cause;
      }
    },
    rejectOrder({ orderId, adminRef, reason }) {
      const cleanReason = reason == null ? null : String(reason).trim().slice(0, 500) || null;
      const timestamp = now().toISOString();
      if (!orders.reject({ id: orderId, adminRef: String(adminRef || ''), reason: cleanReason, timestamp })) {
        throw new OrderError('order cannot be rejected from its current state', 'INVALID_ORDER_STATE');
      }
      return orders.findById(orderId);
    },
  };
}

function createQrService({ db, settings, storage, now = () => new Date() }) {
  const replace = db.transaction((input) => {
    const previous = settings.get(input.key);
    settings.set(input);
    return previous;
  });
  return {
    async storeQrImage(method, file, adminRef) {
      if (!['wechat', 'alipay'].includes(method)) throw new OrderError('payment method is invalid', 'PAYMENT_METHOD_INVALID');
      const stored = await storage.store(file);
      let previous;
      try {
        previous = replace({ key: `payment_qr:${method}`, value: stored.filename, updatedAt: now().toISOString(), updatedBy: adminRef });
      } catch (error) { await storage.remove(stored.filename); throw error; }
      if (previous && previous.value !== stored.filename) await storage.remove(previous.value);
      return { method, available: true, filename: stored.filename };
    },
    getActiveQr(method) {
      if (!['wechat', 'alipay'].includes(method)) return { method, available: false };
      const setting = settings.get(`payment_qr:${method}`);
      return setting ? { method, available: true, filename: setting.value } : { method, available: false };
    },
  };
}

module.exports = { createOrderService, createQrService, OrderError };
