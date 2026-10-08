const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectImage, storePrivateImage, MAX_IMAGE_BYTES } = require('../storefront/middleware/uploads');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('body'), Buffer.from('49454e44ae426082', 'hex')]);
const JPEG = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
const WEBP = Buffer.from('524946460400000057454250', 'hex');

test('accepts matching PNG, JPEG, and WebP image bytes', () => {
  assert.equal(detectImage(PNG, 'image/png').extension, '.png');
  assert.equal(detectImage(JPEG, 'image/jpeg').extension, '.jpg');
  assert.equal(detectImage(WEBP, 'image/webp').extension, '.webp');
});

test('rejects mismatched, unsafe, polyglot, and oversized uploads', () => {
  assert.throws(() => detectImage(PNG, 'image/jpeg'), /match/i);
  assert.throws(() => detectImage(Buffer.from('<svg/>'), 'image/svg+xml'), /image/i);
  assert.throws(() => detectImage(Buffer.concat([PNG, Buffer.from('<script>')]), 'image/png'), /image/i);
  assert.throws(() => detectImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'), /large/i);
});

test('stores random mode-0600 files outside the public directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-uploads-'));
  const storageDir = path.join(root, 'private');
  try {
    const stored = await storePrivateImage({ buffer: PNG, mimetype: 'image/png' }, { storageDir, randomUUID: () => 'random-id' });
    assert.equal(stored.filename, 'random-id.png');
    assert.equal(stored.path.startsWith(storageDir), true);
    assert.equal(fs.statSync(stored.path).mode & 0o777, 0o600);
    assert.deepEqual(fs.readFileSync(stored.path), PNG);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
