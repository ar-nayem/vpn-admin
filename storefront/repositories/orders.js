function createOrderRepository(db) {
  const insert = db.prepare(`
    INSERT INTO orders
      (id, customer_id, profile_id, state, plan_id, plan_name, months, price_cny,
       quota_bytes, down_kbps, up_kbps, expires_at, payment_method, proof_filename, created_at)
    VALUES
      (@id, @customerId, @profileId, @state, @planId, @planName, @months, @priceCny,
       @quotaBytes, @downKbps, @upKbps, @expiresAt, @paymentMethod, @proofFilename, @createdAt)
  `);
  const byId = db.prepare('SELECT * FROM orders WHERE id = ?');
  const reject = db.prepare(`
    UPDATE orders SET state = 'rejected', rejection_reason = @reason, reviewed_by = @adminRef,
      reviewed_at = @timestamp, updated_at = @timestamp
    WHERE id = @id AND state = 'pending'
  `);
  return {
    create(input) { insert.run(input); return byId.get(input.id); },
    findById(id) { return byId.get(id) || null; },
    reject(input) { return reject.run(input).changes === 1; },
  };
}

module.exports = { createOrderRepository };
