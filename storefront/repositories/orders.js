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
  const claim = db.prepare(`
    UPDATE orders SET state = 'provisioning', idempotency_key = @idempotencyKey,
      reviewed_by = @adminRef, reviewed_at = @timestamp, provisioning_error = NULL, updated_at = @timestamp
    WHERE id = @id AND state IN ('pending', 'provisioning_failed')
  `);
  const approve = db.prepare(`
    UPDATE orders SET state = 'approved', provisioning_error = NULL, updated_at = @timestamp
    WHERE id = @id AND state = 'provisioning'
  `);
  const fail = db.prepare(`
    UPDATE orders SET state = 'provisioning_failed', provisioning_error = @error, updated_at = @timestamp
    WHERE id = @id AND state = 'provisioning'
  `);
  return {
    create(input) { insert.run(input); return byId.get(input.id); },
    findById(id) { return byId.get(id) || null; },
    reject(input) { return reject.run(input).changes === 1; },
    claimProvisioning(input) { return claim.run(input).changes === 1; },
    markApproved(input) { return approve.run(input).changes === 1; },
    markProvisioningFailed(input) { return fail.run(input).changes === 1; },
  };
}

module.exports = { createOrderRepository };
