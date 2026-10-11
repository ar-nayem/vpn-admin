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

test('registers one password-only customer without an email verification grant', () => {
  const f = fixture();
  try {
    const customer = f.auth.register({
      name: ' Buyer ',
      email: ' Buyer@Example.com ',
      password: 'correct horse battery staple',
    });

    assert.deepEqual(customer, {
      id: customer.id,
      name: 'Buyer',
      email: 'buyer@example.com',
      verifiedAt: null,
    });
    const stored = f.db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
    assert.notEqual(stored.password_hash, 'correct horse battery staple');
    assert.equal(stored.password_hash.startsWith('$2'), true);
    assert.throws(() => f.auth.register({
      name: 'Other',
      email: 'buyer@example.com',
      password: 'another secure password',
    }), /already exists/i);
  } finally {
    f.close();
  }
});

test('password-only registration cannot claim an existing guest identity', () => {
  const f = fixture();
  try {
    f.db.prepare(`INSERT INTO customers
      (id,email,normalized_email,name,password_hash,verified_at,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      'guest-1', 'guest@example.com', 'guest@example.com', 'Guest Buyer', null,
      '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z',
    );

    assert.throws(
      () => f.auth.register({
        name: 'Guest Buyer', email: 'guest@example.com', password: 'new secure password',
      }),
      /already exists/i,
    );
    assert.equal(f.db.prepare('SELECT password_hash FROM customers WHERE id = ?').get('guest-1').password_hash, null);
  } finally {
    f.close();
  }
});

test('supports password sign in and exposes no six-digit account sign in', () => {
  const f = fixture();
  try {
    const email = 'buyer@example.com';
    f.auth.register({ name: 'Buyer', email, password: 'correct horse battery staple' });

    assert.equal(f.auth.loginWithPassword({ email, password: 'correct horse battery staple' }).email, email);
    assert.throws(() => f.auth.loginWithPassword({ email, password: 'wrong password' }), /email or password/i);
    assert.equal(f.auth.loginWithCode, undefined);
  } finally {
    f.close();
  }
});

test('recovers password only with a recovery-purpose grant', () => {
  const f = fixture();
  try {
    const email = 'buyer@example.com';
    f.auth.register({ name: 'Buyer', email, password: 'correct horse battery staple' });
    const trackingGrant = f.grant(email, 'tracking');
    assert.throws(
      () => f.auth.resetPassword({ email, password: 'new secure password', verificationGrant: trackingGrant }),
      /verification/i
    );

    f.auth.resetPassword({ email, password: 'new secure password', verificationGrant: f.grant(email, 'password-reset') });
    assert.equal(f.auth.loginWithPassword({ email, password: 'new secure password' }).email, email);
    assert.throws(() => f.auth.loginWithPassword({ email, password: 'correct horse battery staple' }), /email or password/i);
  } finally {
    f.close();
  }
});

test('password recovery cannot create the first password for a guest', () => {
  const f = fixture();
  try {
    const email = 'guest@example.com';
    f.db.prepare(`INSERT INTO customers
      (id,email,normalized_email,name,password_hash,verified_at,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      'guest-1', email, email, 'Guest Buyer', null,
      '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z',
    );

    assert.throws(
      () => f.auth.resetPassword({
        email, password: 'new secure password', verificationGrant: f.grant(email, 'password-reset'),
      }),
      /verification/i,
    );
    assert.equal(f.db.prepare('SELECT password_hash FROM customers WHERE id = ?').get('guest-1').password_hash, null);
  } finally {
    f.close();
  }
});

test('rejects invalid customer fields before storage', () => {
  const f = fixture();
  try {
    assert.throws(() => f.auth.register({ name: '', email: 'bad', password: 'short' }), /name/i);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM customers').get().count, 0);
  } finally {
    f.close();
  }
});

test('account page uses passwords only while retaining code-based recovery and trial', () => {
  const html = fs.readFileSync(require.resolve('../storefront/public/auth.html'), 'utf8');
  const browser = fs.readFileSync(require.resolve('../storefront/public/auth.js'), 'utf8');
  assert.doesNotMatch(html, /data-tab="code"|id="code-form"|id="reg-code"/);
  assert.match(html, /id="password-form"/);
  assert.match(html, /id="register-form"/);
  assert.match(html, /id="trial-code"/);
  assert.doesNotMatch(browser, /loginWithCode|\/api\/auth\/login\/code|purpose: 'register'|purpose: 'login'/);
  assert.match(browser, /purpose: 'password-reset'/);
  assert.match(browser, /purpose: 'trial'/);
});
