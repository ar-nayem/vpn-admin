function createCustomerRepository(db) {
  const findByIdStatement = db.prepare('SELECT * FROM customers WHERE id = ?');
  const findByEmailStatement = db.prepare('SELECT * FROM customers WHERE normalized_email = ?');
  const insertStatement = db.prepare(`
    INSERT INTO customers
      (id, email, normalized_email, name, password_hash, verified_at, created_at)
    VALUES
      (@id, @email, @normalizedEmail, @name, @passwordHash, @verifiedAt, @createdAt)
  `);
  const updatePasswordStatement = db.prepare(`
    UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?
  `);

  return {
    findById(id) {
      return findByIdStatement.get(id) || null;
    },
    findByNormalizedEmail(normalizedEmail) {
      return findByEmailStatement.get(normalizedEmail) || null;
    },
    create(customer) {
      insertStatement.run(customer);
      return findByEmailStatement.get(customer.normalizedEmail);
    },
    updatePassword(id, passwordHash, updatedAt) {
      return updatePasswordStatement.run(passwordHash, updatedAt, id).changes === 1;
    },
  };
}

module.exports = { createCustomerRepository };
