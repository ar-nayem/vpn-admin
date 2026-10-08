const crypto = require('crypto');
const { encryptJson } = require('../crypto');
const { normalizeEmail } = require('./auth');

const PURPOSES = new Set(['register', 'login', 'password-reset', 'tracking', 'trial', 'purchase']);

function digest(secret, label, value) {
  return crypto.createHmac('sha256', secret).update(`${label}\n${value}`).digest('hex');
}

function safeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function createVerificationService({
  challenges,
  outbox,
  otpPepper,
  outboxKey,
  now = () => new Date(),
  randomInt = crypto.randomInt,
  randomUUID = crypto.randomUUID,
  randomBytes = crypto.randomBytes,
}) {
  if (!otpPepper) throw new TypeError('otpPepper is required');

  function validatePurpose(purpose) {
    if (!PURPOSES.has(purpose)) throw new TypeError('verification purpose is invalid');
  }

  return {
    requestCode({ email, purpose }) {
      const normalizedEmail = normalizeEmail(email);
      validatePurpose(purpose);
      const createdAt = now();
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const id = randomUUID();
      const timestamp = createdAt.toISOString();
      const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000).toISOString();
      challenges.invalidateActive(normalizedEmail, purpose, timestamp);
      challenges.create({
        id,
        normalizedEmail,
        purpose,
        codeHash: digest(otpPepper, `${normalizedEmail}:${purpose}`, code),
        expiresAt,
        createdAt: timestamp,
      });
      outbox.enqueue({
        id: randomUUID(),
        template: 'verification-code',
        recipient: normalizedEmail,
        encryptedPayload: encryptJson({ code, purpose }, outboxKey, randomBytes),
        availableAt: timestamp,
        createdAt: timestamp,
      });
      return { email: normalizedEmail, expiresAt };
    },
    verifyCode({ email, purpose, code }) {
      const normalizedEmail = normalizeEmail(email);
      validatePurpose(purpose);
      const challenge = challenges.findLatestActive(normalizedEmail, purpose);
      if (!challenge) throw new Error('verification code is invalid');
      const current = now();
      if (challenge.expires_at <= current.toISOString()) throw new Error('verification code has expired');
      if (challenge.attempts >= 5) throw new Error('verification code is invalid');
      const submittedHash = digest(otpPepper, `${normalizedEmail}:${purpose}`, String(code || ''));
      if (!safeEqualHex(challenge.code_hash, submittedHash)) {
        challenges.incrementAttempts(challenge.id);
        throw new Error('verification code is invalid');
      }
      const grant = randomBytes(32).toString('base64url');
      const grantHash = digest(otpPepper, `grant:${normalizedEmail}:${purpose}`, grant);
      const consumedAt = current.toISOString();
      const grantExpiresAt = new Date(current.getTime() + 15 * 60 * 1000).toISOString();
      if (!challenges.grant({ id: challenge.id, consumedAt, grantHash, grantExpiresAt })) {
        throw new Error('verification code is invalid');
      }
      return { grant, expiresAt: grantExpiresAt };
    },
    consumeGrant({ email, purpose, grant }) {
      const normalizedEmail = normalizeEmail(email);
      validatePurpose(purpose);
      const consumedAt = now().toISOString();
      return challenges.consumeGrant({
        normalizedEmail,
        purpose,
        grantHash: digest(otpPepper, `grant:${normalizedEmail}:${purpose}`, String(grant || '')),
        consumedAt,
      });
    },
  };
}

module.exports = { createVerificationService };
