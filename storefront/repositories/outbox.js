function createOutboxRepository(db) {
  const insertStatement = db.prepare(`
    INSERT INTO email_outbox
      (id, template, recipient, encrypted_payload, state, attempts, available_at, created_at)
    VALUES
      (@id, @template, @recipient, @encryptedPayload, 'queued', 0, @availableAt, @createdAt)
  `);

  return {
    enqueue(message) {
      insertStatement.run(message);
      return message.id;
    },
  };
}

module.exports = { createOutboxRepository };
