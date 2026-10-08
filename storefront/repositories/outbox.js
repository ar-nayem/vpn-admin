function createOutboxRepository(db) {
  const insertStatement = db.prepare(`
    INSERT INTO email_outbox
      (id, template, recipient, encrypted_payload, state, attempts, available_at, created_at)
    VALUES
      (@id, @template, @recipient, @encryptedPayload, 'queued', 0, @availableAt, @createdAt)
  `);
  const readyStatement = db.prepare(`
    SELECT * FROM email_outbox WHERE state = 'queued' AND available_at <= ? ORDER BY created_at LIMIT ?
  `);
  const claimStatement = db.prepare(`
    UPDATE email_outbox SET state = 'sending', claimed_at = ? WHERE id = ? AND state = 'queued'
  `);
  const sentStatement = db.prepare(`UPDATE email_outbox SET state = 'sent', sent_at = ?, last_error = NULL WHERE id = ? AND state = 'sending'`);
  const retryStatement = db.prepare(`
    UPDATE email_outbox SET state = @state, attempts = attempts + 1, available_at = @availableAt,
      claimed_at = NULL, last_error = 'Email delivery failed'
    WHERE id = @id AND state = 'sending'
  `);
  const claimTransaction = db.transaction(({ limit, timestamp }) => {
    const candidates = readyStatement.all(timestamp, limit);
    return candidates.filter((row) => claimStatement.run(timestamp, row.id).changes === 1);
  });

  return {
    enqueue(message) {
      insertStatement.run(message);
      return message.id;
    },
    claimBatch(input) { return claimTransaction(input); },
    markSent(id, timestamp) { return sentStatement.run(timestamp, id).changes === 1; },
    markFailedAttempt(id, current) {
      const row = db.prepare('SELECT attempts FROM email_outbox WHERE id = ?').get(id);
      if (!row) return false;
      const attempts = row.attempts + 1;
      const delays = [1, 5, 20, 60];
      const state = attempts >= 5 ? 'failed' : 'queued';
      const delayMinutes = delays[Math.min(attempts - 1, delays.length - 1)];
      const availableAt = new Date(current.getTime() + delayMinutes * 60 * 1000).toISOString();
      return retryStatement.run({ id, state, availableAt }).changes === 1;
    },
  };
}

module.exports = { createOutboxRepository };
