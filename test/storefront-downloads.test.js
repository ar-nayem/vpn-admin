const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createDownloadTokenRepository } = require('../storefront/repositories/download-tokens');
const { createDownloadService } = require('../storefront/services/downloads');

function fixture(now = '2026-10-08T00:00:00.000Z') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-download-'));
  const db = openDatabase(path.join(directory, 'storefront.db'));
  db.prepare('INSERT INTO customers (id,email,normalized_email,name,created_at) VALUES (?,?,?,?,?)').run('c1', 'a@b.com', 'a@b.com', 'A', now);
  db.prepare(`INSERT INTO vpn_profiles (id,customer_id,code_name,normalized_code_name,state,created_at) VALUES (?,?,?,?,?,?)`)
    .run('p1', 'c1', 'Phone', 'phone', 'active', now);
  let current = new Date(now);
  const service = createDownloadService({
    db, tokens: createDownloadTokenRepository(db), downloadKey: Buffer.alloc(32, 4),
    now: () => current, randomUUID: () => 'token-id', randomBytes: (length) => Buffer.alloc(length, 7),
  });
  return { db, service, advance(ms) { current = new Date(current.getTime() + ms); }, close() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('creates a hashed encrypted 24-hour token and redeems it once', () => {
  const f = fixture();
  try {
    const created = f.service.createDownloadToken({ profileId: 'p1', configContent: '[Interface]\nPrivateKey=secret', filename: 'Nayem-Ahmed-iPhone.conf' });
    assert.equal(Buffer.from(created.token, 'base64url').length, 32);
    assert.equal(created.expiresAt, '2026-10-09T00:00:00.000Z');
    const stored = f.db.prepare('SELECT * FROM download_tokens').get();
    assert.notEqual(stored.token_hash, created.token);
    assert.doesNotMatch(stored.config_ciphertext, /PrivateKey|secret/);
    assert.deepEqual(f.service.redeemDownloadToken(created.token), {
      filename: 'Nayem-Ahmed-iPhone.conf', content: '[Interface]\nPrivateKey=secret', contentType: 'text/plain', cacheControl: 'no-store',
    });
    assert.throws(() => f.service.redeemDownloadToken(created.token), /invalid|used/i);
  } finally { f.close(); }
});

test('rejects expired tokens without exposing configuration', () => {
  const f = fixture();
  try {
    const created = f.service.createDownloadToken({ profileId: 'p1', configContent: 'secret', filename: 'phone.conf' });
    f.advance(24 * 60 * 60 * 1000 + 1);
    assert.throws(() => f.service.redeemDownloadToken(created.token), /expired|invalid/i);
  } finally { f.close(); }
});
