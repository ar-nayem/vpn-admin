function createProfileRepository(db) {
  const insertStatement = db.prepare(`
    INSERT INTO vpn_profiles
      (id, customer_id, code_name, normalized_code_name, trial_key, state,
       plan_id, plan_name, quota_bytes, down_kbps, up_kbps, expires_at, created_at)
    VALUES
      (@id, @customerId, @codeName, @normalizedCodeName, @trialKey, @state,
       @planId, @planName, @quotaBytes, @downKbps, @upKbps, @expiresAt, @createdAt)
  `);
  const activateStatement = db.prepare(`
    UPDATE vpn_profiles
    SET state = 'active', device_id = @deviceId, pubkey = @pubkey, ip = @ip, updated_at = @updatedAt
    WHERE id = @id AND state = 'pending'
  `);
  const byIdStatement = db.prepare('SELECT * FROM vpn_profiles WHERE id = ?');
  const byCustomerStatement = db.prepare('SELECT * FROM vpn_profiles WHERE customer_id = ? ORDER BY created_at, code_name');
  const byEmailStatement = db.prepare(`
    SELECT p.* FROM vpn_profiles p
    JOIN customers c ON c.id = p.customer_id
    WHERE c.normalized_email = ?
    ORDER BY p.created_at, p.code_name
  `);
  const deletePendingStatement = db.prepare("DELETE FROM vpn_profiles WHERE id = ? AND state = 'pending'");

  return {
    create(profile) { insertStatement.run(profile); return byIdStatement.get(profile.id); },
    activate(input) { return activateStatement.run(input).changes === 1; },
    findById(id) { return byIdStatement.get(id) || null; },
    findByCustomer(customerId) { return byCustomerStatement.all(customerId); },
    findByNormalizedEmail(email) { return byEmailStatement.all(email); },
    deletePending(id) { return deletePendingStatement.run(id).changes === 1; },
  };
}

module.exports = { createProfileRepository };
