function createChallengeRepository(db) {
  const invalidateStatement = db.prepare(`
    UPDATE verification_challenges
    SET consumed_at = ?
    WHERE normalized_email = ? AND purpose = ? AND consumed_at IS NULL
  `);
  const insertStatement = db.prepare(`
    INSERT INTO verification_challenges
      (id, normalized_email, purpose, code_hash, expires_at, created_at)
    VALUES
      (@id, @normalizedEmail, @purpose, @codeHash, @expiresAt, @createdAt)
  `);
  const latestStatement = db.prepare(`
    SELECT * FROM verification_challenges
    WHERE normalized_email = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const incrementStatement = db.prepare(`
    UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?
  `);
  const grantStatement = db.prepare(`
    UPDATE verification_challenges
    SET consumed_at = @consumedAt,
        grant_hash = @grantHash,
        grant_expires_at = @grantExpiresAt
    WHERE id = @id AND consumed_at IS NULL
  `);
  const consumeGrantStatement = db.prepare(`
    UPDATE verification_challenges
    SET grant_consumed_at = @consumedAt
    WHERE normalized_email = @normalizedEmail
      AND purpose = @purpose
      AND grant_hash = @grantHash
      AND grant_consumed_at IS NULL
      AND grant_expires_at > @consumedAt
  `);

  return {
    invalidateActive(normalizedEmail, purpose, timestamp) {
      invalidateStatement.run(timestamp, normalizedEmail, purpose);
    },
    create(challenge) {
      insertStatement.run(challenge);
    },
    findLatestActive(normalizedEmail, purpose) {
      return latestStatement.get(normalizedEmail, purpose) || null;
    },
    incrementAttempts(id) {
      incrementStatement.run(id);
    },
    grant(input) {
      return grantStatement.run(input).changes === 1;
    },
    consumeGrant(input) {
      return consumeGrantStatement.run(input).changes === 1;
    },
  };
}

module.exports = { createChallengeRepository };
