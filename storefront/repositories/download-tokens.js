function createDownloadTokenRepository(db) {
  const insert = db.prepare(`
    INSERT INTO download_tokens (id, profile_id, token_hash, config_ciphertext, expires_at, created_at)
    VALUES (@id, @profileId, @tokenHash, @configCiphertext, @expiresAt, @createdAt)
  `);
  const find = db.prepare('SELECT * FROM download_tokens WHERE token_hash = ?');
  const consume = db.prepare(`
    UPDATE download_tokens SET consumed_at = @consumedAt
    WHERE token_hash = @tokenHash AND consumed_at IS NULL AND expires_at > @consumedAt
  `);
  return {
    create(input) { insert.run(input); return input.id; },
    findByHash(hash) { return find.get(hash) || null; },
    consume(input) { return consume.run(input).changes === 1; },
  };
}

module.exports = { createDownloadTokenRepository };
