const crypto = require('crypto');

function requireKey(key) {
  const value = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'base64');
  if (value.length !== 32) throw new TypeError('encryption key must be 32 bytes');
  return value;
}

function encryptJson(value, key, randomBytes = crypto.randomBytes) {
  const iv = randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', requireKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  });
}

function decryptJson(envelope, key) {
  const parsed = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  if (parsed.v !== 1) throw new Error('encrypted payload version is unsupported');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    requireKey(key),
    Buffer.from(parsed.iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { encryptJson, decryptJson };
