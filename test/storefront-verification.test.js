const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createChallengeRepository } = require('../storefront/repositories/challenges');
const { createOutboxRepository } = require('../storefront/repositories/outbox');
const { createVerificationService } = require('../storefront/services/verification');
const { decryptJson } = require('../storefront/crypto');

const OUTBOX_KEY = Buffer.alloc(32, 7);

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-verification-'));
  const db = openDatabase(path.join(directory, 'storefront.db'));
  let nowMs = Date.parse('2026-10-08T00:00:00.000Z');
  const challenges = createChallengeRepository(db);
  const outbox = createOutboxRepository(db);
  const service = createVerificationService({
    challenges,
    outbox,
    otpPepper: 'otp-test-pepper',
    outboxKey: OUTBOX_KEY,
    now: () => new Date(nowMs),
    randomInt: () => 12345,
    randomUUID: (() => {
      let count = 0;
      return () => `id-${++count}`;
    })(),
    randomBytes: (length) => Buffer.alloc(length, 3),
  });
  return {
    db,
    service,
    advance(ms) { nowMs += ms; },
    close() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('queues a six-digit code without storing it in plaintext', () => {
  const f = fixture();
  try {
    const result = f.service.requestCode({ email: ' Buyer@Example.com ', purpose: 'tracking' });
    const challenge = f.db.prepare('SELECT * FROM verification_challenges').get();
    const message = f.db.prepare('SELECT * FROM email_outbox').get();
    const payload = decryptJson(message.encrypted_payload, OUTBOX_KEY);

    assert.equal(result.email, 'buyer@example.com');
    assert.equal(payload.code, '012345');
    assert.equal(payload.purpose, 'tracking');
    assert.equal(challenge.normalized_email, 'buyer@example.com');
    assert.equal(challenge.code_hash.includes('012345'), false);
    assert.equal(JSON.stringify(challenge).includes('012345'), false);
  } finally {
    f.close();
  }
});

test('verifies once and returns a purpose-bound short-lived grant', () => {
  const f = fixture();
  try {
    f.service.requestCode({ email: 'buyer@example.com', purpose: 'register' });
    const verified = f.service.verifyCode({ email: 'buyer@example.com', purpose: 'register', code: '012345' });

    assert.equal(typeof verified.grant, 'string');
    assert.ok(verified.grant.length >= 32);
    assert.equal(f.service.consumeGrant({
      email: 'buyer@example.com',
      purpose: 'register',
      grant: verified.grant,
    }), true);
    assert.equal(f.service.consumeGrant({
      email: 'buyer@example.com',
      purpose: 'register',
      grant: verified.grant,
    }), false);
  } finally {
    f.close();
  }
});

test('rejects expired codes, wrong purposes, and a sixth bad attempt', () => {
  const f = fixture();
  try {
    f.service.requestCode({ email: 'buyer@example.com', purpose: 'tracking' });
    assert.throws(
      () => f.service.verifyCode({ email: 'buyer@example.com', purpose: 'register', code: '012345' }),
      /verification code/i
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.throws(
        () => f.service.verifyCode({ email: 'buyer@example.com', purpose: 'tracking', code: '999999' }),
        /verification code/i
      );
    }
    assert.throws(
      () => f.service.verifyCode({ email: 'buyer@example.com', purpose: 'tracking', code: '012345' }),
      /verification code/i
    );

    f.service.requestCode({ email: 'later@example.com', purpose: 'tracking' });
    f.advance(10 * 60 * 1000 + 1);
    assert.throws(
      () => f.service.verifyCode({ email: 'later@example.com', purpose: 'tracking', code: '012345' }),
      /expired/i
    );
  } finally {
    f.close();
  }
});

test('new code invalidates the previous unconsumed challenge', () => {
  const f = fixture();
  try {
    f.service.requestCode({ email: 'buyer@example.com', purpose: 'tracking' });
    f.service.requestCode({ email: 'buyer@example.com', purpose: 'tracking' });
    const active = f.db.prepare(`
      SELECT COUNT(*) AS count
      FROM verification_challenges
      WHERE normalized_email = 'buyer@example.com'
        AND purpose = 'tracking'
        AND consumed_at IS NULL
    `).get().count;
    assert.equal(active, 1);
  } finally {
    f.close();
  }
});
