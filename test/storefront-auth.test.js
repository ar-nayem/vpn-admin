const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createCustomerRepository } = require('../storefront/repositories/customers');
const { createChallengeRepository } = require('../storefront/repositories/challenges');
const { createOutboxRepository } = require('../storefront/repositories/outbox');
const { createVerificationService } = require('../storefront/services/verification');
const { createAuthService } = require('../storefront/services/auth');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-auth-'));
  const db = openDatabase(path.join(directory, 'storefront.db'));
  let id = 0;
  const challenges = createChallengeRepository(db);
  const verification = createVerificationService({
    challenges,
    outbox: createOutboxRepository(db),
    otpPepper: 'otp-test-pepper',
    outboxKey: Buffer.alloc(32, 8),
    now: () => new Date('2026-10-08T00:00:00.000Z'),
    randomInt: () => 654321,
    randomUUID: () => `challenge-${++id}`,
    randomBytes: (length) => Buffer.alloc(length, id + 1),
  });
  const auth = createAuthService({
    db,
    customers: createCustomerRepository(db),
    verification,
    now: () => new Date('2026-10-08T00:00:00.000Z'),
    randomUUID: () => `customer-${++id}`,
  });
  function grant(email, purpose) {
    verification.requestCode({ email, purpose });
    return verification.verifyCode({ email, purpose, code: '654321' }).grant;
  }
  return {
    db,
    auth,
    grant,
    close() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('registers one verified customer and never exposes password data', () => {
  const f = fixture();
  try {
    const verificationGrant = f.grant('Buyer@Example.com', 'register');
    const customer = f.auth.register({
      name: ' Buyer ',
      email: ' Buyer@Example.com ',
      password: 'correct horse battery staple',
      verificationGrant,
    });

    assert.deepEqual(customer, {
      id: customer.id,
      name: 'Buyer',
      email: 'buyer@example.com',
      verifiedAt: '2026-10-08T00:00:00.000Z',
    });
    const stored = f.db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
    assert.notEqual(stored.password_hash, 'correct horse battery staple');
    assert.equal(stored.password_hash.startsWith('$2'), true);
    assert.throws(() => f.auth.register({
      name: 'Other',
      email: 'buyer@example.com',
      password: 'another secure password',
      verificationGrant,
    }), /already exists/i);
  } finally {
    f.close();
  }
});

test('supports password and six-digit-code sign in', () => {
  const f = fixture();
  try {
    const email = 'buyer@example.com';
    f.auth.register({ name: 'Buyer', email, password: 'correct horse battery staple', verificationGrant: f.grant(email, 'register') });

    assert.equal(f.auth.loginWithPassword({ email, password: 'correct horse battery staple' }).email, email);
    assert.throws(() => f.auth.loginWithPassword({ email, password: 'wrong password' }), /email or password/i);
    assert.equal(f.auth.loginWithCode({ email, verificationGrant: f.grant(email, 'login') }).email, email);
  } finally {
    f.close();
  }
});

test('code sign in reports a missing account as a customer action, not a service outage', () => {
  const f = fixture();
  try {
    const email = 'new-customer@example.com';
    const verificationGrant = f.grant(email, 'login');
    assert.throws(
      () => f.auth.loginWithCode({ email, verificationGrant }),
      (error) => error.code === 'ACCOUNT_NOT_FOUND' && error.status === 404
    );
  } finally {
    f.close();
  }
});

test('recovers password only with a recovery-purpose grant', () => {
  const f = fixture();
  try {
    const email = 'buyer@example.com';
    f.auth.register({ name: 'Buyer', email, password: 'correct horse battery staple', verificationGrant: f.grant(email, 'register') });
    const loginGrant = f.grant(email, 'login');
    assert.throws(
      () => f.auth.resetPassword({ email, password: 'new secure password', verificationGrant: loginGrant }),
      /verification/i
    );

    f.auth.resetPassword({ email, password: 'new secure password', verificationGrant: f.grant(email, 'password-reset') });
    assert.equal(f.auth.loginWithPassword({ email, password: 'new secure password' }).email, email);
    assert.throws(() => f.auth.loginWithPassword({ email, password: 'correct horse battery staple' }), /email or password/i);
  } finally {
    f.close();
  }
});

test('rejects invalid customer fields before storage', () => {
  const f = fixture();
  try {
    assert.throws(() => f.auth.register({ name: '', email: 'bad', password: 'short', verificationGrant: 'none' }), /name/i);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM customers').get().count, 0);
  } finally {
    f.close();
  }
});
