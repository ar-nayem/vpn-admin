function createSettingsRepository(db) {
  const get = db.prepare('SELECT * FROM settings WHERE key = ?');
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at, updated_by) VALUES (@key, @value, @updatedAt, @updatedBy)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `);
  return {
    get(key) { return get.get(key) || null; },
    set(input) { upsert.run(input); return get.get(input.key); },
  };
}

module.exports = { createSettingsRepository };
