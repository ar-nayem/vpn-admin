const crypto = require('crypto');

const { normalizeEmail } = require('./auth');

function createProfileService({ db, customers, profiles, verification, now = () => new Date(), randomUUID = crypto.randomUUID }) {
  const createGuest = db.transaction((input) => {
    if (!verification.consumeGrant({ email: input.email, purpose: 'purchase', grant: input.verificationGrant })) throw Object.assign(new Error('email verification is invalid or expired'), { code: 'VERIFICATION_REQUIRED' });
    let customer = customers.findByNormalizedEmail(input.email);
    if (!customer) customer = customers.create({ id: randomUUID(), email: input.email, normalizedEmail: input.email, name: input.name, passwordHash: null, verifiedAt: input.timestamp, createdAt: input.timestamp });
    if (customer.password_hash) throw Object.assign(new Error('sign in to purchase for this account'), { code: 'AUTH_REQUIRED' });
    const existing = profiles.findByCustomer(customer.id);
    const matching = existing.find((profile) => profile.normalized_code_name === input.normalizedCodeName);
    if (matching) return { customerId: customer.id, profile: matching };
    if (existing.length) throw Object.assign(new Error('guest emails can use one device; sign in to add more'), { code: 'AUTH_REQUIRED' });
    return { customerId: customer.id, profile: profiles.create({ id: randomUUID(), customerId: customer.id, codeName: input.codeName, normalizedCodeName: input.normalizedCodeName, trialKey: null, state: 'pending', planId: null, planName: null, quotaBytes: null, downKbps: null, upKbps: null, expiresAt: null, createdAt: input.timestamp }) };
  });
  return {
    createPaidProfile(customerId, codeNameValue) {
      const codeName = String(codeNameValue || '').trim();
      if (!codeName || codeName.length > 80) throw new TypeError('code name is required and must be 80 characters or fewer');
      if (!/^[\p{L}\p{N} _.-]+$/u.test(codeName)) throw new TypeError('code name contains unsupported characters');
      try {
        const row = profiles.create({
          id: randomUUID(), customerId, codeName, normalizedCodeName: codeName.toLocaleLowerCase(),
          trialKey: null, state: 'pending', planId: null, planName: null, quotaBytes: null,
          downKbps: null, upKbps: null, expiresAt: null, createdAt: now().toISOString(),
        });
        return { id: row.id, codeName: row.code_name, state: row.state };
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw Object.assign(new Error('that code name is already in use'), { code: 'CODE_NAME_EXISTS' });
        throw error;
      }
    },
    createGuestPaidProfile({ name, email, codeName, verificationGrant }) {
      const normalizedEmail = normalizeEmail(email);
      const cleanName = String(name || '').trim();
      const cleanCodeName = String(codeName || '').trim();
      if (!cleanName || !cleanCodeName || !/^[\p{L}\p{N} _.-]+$/u.test(cleanCodeName)) throw new TypeError('name and a valid device code name are required');
      return createGuest({ name: cleanName, email: normalizedEmail, codeName: cleanCodeName, normalizedCodeName: cleanCodeName.toLocaleLowerCase(), verificationGrant, timestamp: now().toISOString() });
    },
  };
}

module.exports = { createProfileService };
