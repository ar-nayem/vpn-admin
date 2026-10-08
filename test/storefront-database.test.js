const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { MIGRATIONS } = require('../storefront/db/schema');

function withTemporaryDatabase(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-storefront-db-'));
  const file = path.join(directory, 'storefront.db');
  const db = openDatabase(file);
  try {
    run(db);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('opens a migrated WAL database with every storefront table', () => {
  withTemporaryDatabase((db) => {
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.at(-1).version);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    for (const name of [
      'customers',
      'verification_challenges',
      'vpn_profiles',
      'packages',
      'orders',
      'email_outbox',
      'download_tokens',
      'settings',
      'audit_events',
      'customer_sessions',
    ]) {
      assert.ok(tables.includes(name), `missing table ${name}`);
    }
  });
});

test('enforces normalized customer and code-name uniqueness', () => {
  withTemporaryDatabase((db) => {
    const insertCustomer = db.prepare('INSERT INTO customers (id, email, normalized_email, name, created_at) VALUES (?, ?, ?, ?, ?)');
    insertCustomer.run('c1', 'Buyer@example.com', 'buyer@example.com', 'Buyer', '2026-10-08T00:00:00.000Z');
    assert.throws(
      () => insertCustomer.run('c2', 'buyer@example.com', 'buyer@example.com', 'Other', '2026-10-08T00:00:00.000Z'),
      /UNIQUE/
    );

    const insertProfile = db.prepare(`
      INSERT INTO vpn_profiles
        (id, customer_id, code_name, normalized_code_name, state, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);
    insertProfile.run('p1', 'c1', 'Phone', 'phone', '2026-10-08T00:00:00.000Z');
    assert.throws(
      () => insertProfile.run('p2', 'c1', 'PHONE', 'phone', '2026-10-08T00:00:00.000Z'),
      /UNIQUE/
    );
  });
});

test('enforces one trial key even when requests race', () => {
  withTemporaryDatabase((db) => {
    db.prepare('INSERT INTO customers (id, email, normalized_email, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'buyer@example.com', 'buyer@example.com', 'Buyer', '2026-10-08T00:00:00.000Z');
    const insert = db.prepare(`
      INSERT INTO vpn_profiles
        (id, customer_id, code_name, normalized_code_name, trial_key, state, created_at)
      VALUES (?, 'c1', ?, ?, 'buyer@example.com', 'pending', '2026-10-08T00:00:00.000Z')
    `);
    insert.run('p1', 'Phone', 'phone');
    assert.throws(() => insert.run('p2', 'Tablet', 'tablet'), /UNIQUE/);
  });
});

test('rolls back a failed transaction completely', () => {
  withTemporaryDatabase((db) => {
    const transaction = db.transaction(() => {
      db.prepare('INSERT INTO customers (id, email, normalized_email, name, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('c1', 'buyer@example.com', 'buyer@example.com', 'Buyer', '2026-10-08T00:00:00.000Z');
      throw new Error('stop');
    });

    assert.throws(() => transaction(), /stop/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customers').get().count, 0);
  });
});
