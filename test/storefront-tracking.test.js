const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createProfileRepository } = require('../storefront/repositories/profiles');
const { createTrackingService } = require('../storefront/services/tracking');

function fixture({ statusFailure = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-tracking-'));
  const db = openDatabase(path.join(directory, 'storefront.db'));
  db.prepare(`INSERT INTO customers (id,email,normalized_email,name,verified_at,created_at) VALUES (?,?,?,?,?,?)`)
    .run('customer-1', 'owner@example.com', 'owner@example.com', 'Owner', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
  db.prepare(`INSERT INTO customers (id,email,normalized_email,name,verified_at,created_at) VALUES (?,?,?,?,?,?)`)
    .run('customer-2', 'other@example.com', 'other@example.com', 'Other', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
  const insert = db.prepare(`INSERT INTO vpn_profiles
    (id,customer_id,code_name,normalized_code_name,state,device_id,pubkey,ip,plan_id,plan_name,quota_bytes,down_kbps,up_kbps,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('profile-1', 'customer-1', 'Phone', 'phone', 'active', 'device-1', 'secret-public-1', '10.0.0.2', 'basic', 'Basic', 1000, 5120, 5120, null, '2026-10-08T00:00:00.000Z');
  insert.run('profile-2', 'customer-2', 'Tablet', 'tablet', 'active', 'device-2', 'secret-public-2', '10.0.0.3', 'premium', 'Premium', 2000, 0, 0, null, '2026-10-08T00:00:00.000Z');
  const service = createTrackingService({
    profiles: createProfileRepository(db),
    verification: { consumeGrant: ({ grant }) => grant === 'valid' },
    provisioning: {
      async getStatus(deviceId) {
        if (statusFailure) throw new Error('socket path and secret');
        return { deviceId, usedBytes: deviceId === 'device-1' ? 1200 : 200, status: 'active', pubkey: 'must-not-leak' };
      },
    },
  });
  return { db, service, close() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('guest tracking requires a tracking grant and scopes by normalized email', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.getGuestDashboard({ email: 'owner@example.com' }), /verification/i);
    const dashboard = await f.service.getGuestDashboard({ email: ' OWNER@example.com ', verificationGrant: 'valid' });
    assert.equal(dashboard.profiles.length, 1);
    assert.equal(dashboard.profiles[0].id, 'profile-1');
    assert.equal(dashboard.profiles[0].usedBytes, 1200);
    assert.equal(dashboard.profiles[0].remainingBytes, 0);
    assert.equal('pubkey' in dashboard.profiles[0], false);
    assert.equal('ip' in dashboard.profiles[0], false);
  } finally { f.close(); }
});

test('registered dashboard returns every profile belonging to that customer', async () => {
  const f = fixture();
  try {
    const dashboard = await f.service.getCustomerDashboard('customer-2');
    assert.deepEqual(dashboard.profiles.map((profile) => profile.codeName), ['Tablet']);
    assert.deepEqual(dashboard.profiles[0], {
      id: 'profile-2', codeName: 'Tablet', planId: 'premium', planName: 'Premium', quotaBytes: 2000,
      usedBytes: 200, remainingBytes: 1800, expiresAt: null, downKbps: 0, upKbps: 0, status: 'active',
    });
  } finally { f.close(); }
});

test('tracking hides internal status failures behind a safe code', async () => {
  const f = fixture({ statusFailure: true });
  try {
    await assert.rejects(f.service.getCustomerDashboard('customer-1'),
      (error) => error.code === 'STATUS_TEMPORARILY_UNAVAILABLE' && !error.message.includes('socket'));
  } finally { f.close(); }
});
