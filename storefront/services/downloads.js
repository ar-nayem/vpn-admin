const crypto = require('crypto');
const { encryptJson, decryptJson } = require('../crypto');

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function createDownloadService({ db, tokens, downloadKey, now = () => new Date(), randomUUID = crypto.randomUUID, randomBytes = crypto.randomBytes }) {
  const redeem = db.transaction((tokenHash, timestamp) => {
    const row = tokens.findByHash(tokenHash);
    if (!row || row.consumed_at) throw new Error('download token is invalid or already used');
    if (row.expires_at <= timestamp) throw new Error('download token has expired or is invalid');
    if (!tokens.consume({ tokenHash, consumedAt: timestamp })) throw new Error('download token is invalid or already used');
    return row.config_ciphertext;
  });
  return {
    createDownloadToken({ profileId, configContent, filename }) {
      const created = now();
      const rawToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(created.getTime() + 24 * 60 * 60 * 1000).toISOString();
      tokens.create({
        id: randomUUID(), profileId, tokenHash: hashToken(rawToken),
        configCiphertext: encryptJson({ content: String(configContent), filename: String(filename) }, downloadKey, randomBytes),
        expiresAt, createdAt: created.toISOString(),
      });
      return { token: rawToken, expiresAt };
    },
    redeemDownloadToken(rawToken) {
      const encrypted = redeem(hashToken(String(rawToken || '')), now().toISOString());
      const payload = decryptJson(encrypted, downloadKey);
      const filename = /^[a-zA-Z0-9_.-]+\.conf$/.test(payload.filename) ? payload.filename : 'vpn.conf';
      return { filename, content: payload.content, contentType: 'text/plain', cacheControl: 'no-store' };
    },
  };
}

module.exports = { createDownloadService };
