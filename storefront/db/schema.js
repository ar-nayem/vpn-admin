const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        normalized_email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT,
        verified_at TEXT,
        trial_consumed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE verification_challenges (
        id TEXT PRIMARY KEY,
        normalized_email TEXT NOT NULL,
        purpose TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        consumed_at TEXT,
        grant_hash TEXT,
        grant_expires_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX verification_lookup
        ON verification_challenges (normalized_email, purpose, created_at DESC);

      CREATE TABLE vpn_profiles (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        code_name TEXT NOT NULL,
        normalized_code_name TEXT NOT NULL,
        trial_key TEXT UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'disabled', 'archived', 'error')),
        device_id TEXT UNIQUE,
        pubkey TEXT UNIQUE,
        ip TEXT,
        plan_id TEXT,
        plan_name TEXT,
        quota_bytes INTEGER,
        down_kbps INTEGER,
        up_kbps INTEGER,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE (customer_id, normalized_code_name)
      );

      CREATE TABLE packages (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        monthly_price_cny INTEGER NOT NULL,
        monthly_quota_bytes INTEGER NOT NULL,
        down_kbps INTEGER NOT NULL,
        up_kbps INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );

      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        profile_id TEXT NOT NULL REFERENCES vpn_profiles(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (state IN ('pending', 'provisioning', 'provisioning_failed', 'approved', 'rejected')),
        plan_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 24),
        price_cny INTEGER NOT NULL CHECK (price_cny > 0),
        quota_bytes INTEGER NOT NULL CHECK (quota_bytes > 0),
        down_kbps INTEGER NOT NULL CHECK (down_kbps >= 0),
        up_kbps INTEGER NOT NULL CHECK (up_kbps >= 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('wechat', 'alipay')),
        proof_filename TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        rejection_reason TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        provisioning_error TEXT,
        delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending', 'queued', 'sent', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE UNIQUE INDEX one_open_order_per_profile
        ON orders(profile_id)
        WHERE state IN ('pending', 'provisioning', 'provisioning_failed');

      CREATE TABLE email_outbox (
        id TEXT PRIMARY KEY,
        template TEXT NOT NULL,
        recipient TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        available_at TEXT NOT NULL,
        claimed_at TEXT,
        sent_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX email_outbox_ready ON email_outbox(state, available_at);

      CREATE TABLE download_tokens (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES vpn_profiles(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        config_ciphertext TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_ref TEXT,
        action TEXT NOT NULL,
        subject_type TEXT,
        subject_ref TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_events_subject ON audit_events(subject_type, subject_ref, created_at DESC);

      CREATE TABLE customer_sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX customer_sessions_expiry ON customer_sessions(expires_at);
    `,
  },
];

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}

module.exports = { MIGRATIONS, migrate };
