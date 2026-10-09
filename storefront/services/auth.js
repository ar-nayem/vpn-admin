const bcrypt = require('bcryptjs');
const crypto = require('crypto');

function customerError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TypeError('email is invalid');
  }
  return email;
}

function cleanName(value) {
  const name = String(value || '').trim();
  if (!name) throw new TypeError('name is required');
  if (name.length > 80) throw new TypeError('name must be 80 characters or fewer');
  return name;
}

function cleanPassword(value) {
  const password = String(value || '');
  if (password.length < 10 || password.length > 128) {
    throw new TypeError('password must be between 10 and 128 characters');
  }
  return password;
}

function publicCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.normalized_email,
    verifiedAt: customer.verified_at,
  };
}

function createAuthService({ db, customers, verification, now = () => new Date(), randomUUID = crypto.randomUUID }) {
  const registerTransaction = db.transaction((input) => {
    if (customers.findByNormalizedEmail(input.normalizedEmail)) {
      throw new Error('an account with this email already exists');
    }
    if (!verification.consumeGrant({
      email: input.normalizedEmail,
      purpose: 'register',
      grant: input.verificationGrant,
    })) {
      throw new Error('email verification is invalid or expired');
    }
    return customers.create({
      id: randomUUID(),
      email: input.normalizedEmail,
      normalizedEmail: input.normalizedEmail,
      name: input.name,
      passwordHash: bcrypt.hashSync(input.password, 12),
      verifiedAt: input.timestamp,
      createdAt: input.timestamp,
    });
  });

  const resetTransaction = db.transaction((input) => {
    const customer = customers.findByNormalizedEmail(input.normalizedEmail);
    if (!customer || !verification.consumeGrant({
      email: input.normalizedEmail,
      purpose: 'password-reset',
      grant: input.verificationGrant,
    })) {
      throw new Error('email verification is invalid or expired');
    }
    customers.updatePassword(customer.id, bcrypt.hashSync(input.password, 12), input.timestamp);
    return publicCustomer(customers.findByNormalizedEmail(input.normalizedEmail));
  });

  return {
    register({ name, email, password, verificationGrant }) {
      const timestamp = now().toISOString();
      return publicCustomer(registerTransaction({
        name: cleanName(name),
        normalizedEmail: normalizeEmail(email),
        password: cleanPassword(password),
        verificationGrant,
        timestamp,
      }));
    },
    loginWithPassword({ email, password }) {
      const customer = customers.findByNormalizedEmail(normalizeEmail(email));
      if (!customer || !customer.password_hash || !bcrypt.compareSync(String(password || ''), customer.password_hash)) {
        throw new Error('email or password is incorrect');
      }
      return publicCustomer(customer);
    },
    loginWithCode({ email, verificationGrant }) {
      const normalizedEmail = normalizeEmail(email);
      const customer = customers.findByNormalizedEmail(normalizedEmail);
      if (!customer) {
        throw customerError('No account exists for this email. Create an account or start free.', 'ACCOUNT_NOT_FOUND', 404);
      }
      if (!verification.consumeGrant({ email: normalizedEmail, purpose: 'login', grant: verificationGrant })) {
        throw customerError('email verification is invalid or expired', 'VERIFICATION_REQUIRED');
      }
      return publicCustomer(customer);
    },
    resetPassword({ email, password, verificationGrant }) {
      return resetTransaction({
        normalizedEmail: normalizeEmail(email),
        password: cleanPassword(password),
        verificationGrant,
        timestamp: now().toISOString(),
      });
    },
  };
}

module.exports = { normalizeEmail, createAuthService };
