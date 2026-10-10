const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('node:vm');

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
  db.prepare(`INSERT INTO customers (id,email,normalized_email,name,verified_at,created_at) VALUES (?,?,?,?,?,?)`)
    .run('customer-3', 'legacy@example.com', 'legacy@example.com', 'Legacy', '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
  const insert = db.prepare(`INSERT INTO vpn_profiles
    (id,customer_id,code_name,normalized_code_name,state,device_id,pubkey,ip,plan_id,plan_name,quota_bytes,down_kbps,up_kbps,expires_at,created_at,analytics_enabled,delivery_filename)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('profile-1', 'customer-1', 'Phone', 'phone', 'active', 'device-1', 'secret-public-1', '10.0.0.2', 'basic', 'Basic', 1000, 5120, 5120, null, '2026-10-08T00:00:00.000Z', 1, 'sensitive.conf');
  insert.run('profile-2', 'customer-2', 'Tablet', 'tablet', 'active', 'device-2', 'secret-public-2', '10.0.0.3', 'premium', 'Premium', 2000, 0, 0, null, '2026-10-08T00:00:00.000Z', 1, 'other-sensitive.conf');
  insert.run('legacy-profile', 'customer-1', 'Legacy', 'legacy', 'active', 'device-legacy', 'secret-legacy', '10.0.0.4', 'basic', 'Basic', 1000, 0, 0, null, '2026-10-08T00:00:00.000Z', 0, null);
  insert.run('disabled-profile', 'customer-1', 'Disabled', 'disabled', 'disabled', 'device-disabled', 'secret-disabled', '10.0.0.5', 'basic', 'Basic', 1000, 0, 0, null, '2026-10-08T00:00:00.000Z', 1, null);
  insert.run('pending-profile', 'customer-1', 'Pending', 'pending', 'pending', null, null, null, null, null, null, null, null, null, '2026-10-08T00:00:00.000Z', 1, 'pending.conf');
  const history = {
    getProfileHistory(profileId, range) {
      if (statusFailure) throw new Error('history database path and secret');
      return { range, timezone: 'UTC', points: [], summary: { uploadedBytes: profileId === 'profile-1' ? 9 : 0 } };
    },
  };
  const service = createTrackingService({
    profiles: createProfileRepository(db),
    verification: { consumeGrant: ({ grant }) => grant === 'valid' },
    usageAnalytics: history,
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
    assert.equal(dashboard.profiles.length, 4);
    const tracked = dashboard.profiles.find((profile) => profile.id === 'profile-1');
    assert.equal(tracked.usedBytes, 1200);
    assert.equal(tracked.remainingBytes, 0);
    assert.equal(dashboard.profiles.some((profile) => 'analyticsEnabled' in profile), false);
    assert.equal(dashboard.profiles.some((profile) => 'deliveryFilename' in profile), false);
    assert.equal(dashboard.profiles.some((profile) => 'pubkey' in profile), false);
    assert.equal(dashboard.profiles.some((profile) => 'ip' in profile), false);
  } finally { f.close(); }
});

test('registered dashboard returns every profile belonging to that customer', async () => {
  const f = fixture();
  try {
    const dashboard = await f.service.getCustomerDashboard('customer-2');
    assert.deepEqual(dashboard.profiles.map((profile) => profile.codeName), ['Tablet']);
    assert.deepEqual(dashboard.profiles[0], {
      id: 'profile-2', codeName: 'Tablet', planId: 'premium', planName: 'Premium', quotaBytes: 2000,
      usedBytes: 200, remainingBytes: 1800, expiresAt: null, downKbps: 0, upKbps: 0, status: 'active', analyticsEnabled: true,
    });
    assert.equal('deliveryFilename' in dashboard.profiles[0], false);
  } finally { f.close(); }
});

test('dashboard history eligibility matches activated device ownership', async () => {
  const f = fixture();
  try {
    const dashboard = await f.service.getCustomerDashboard('customer-1');
    assert.deepEqual(dashboard.profiles.filter((profile) => profile.analyticsEnabled).map((profile) => profile.id), ['profile-1']);
    assert.equal(dashboard.profiles.find((profile) => profile.id === 'pending-profile').analyticsPending, true);
    assert.equal(dashboard.profiles.find((profile) => profile.id === 'pending-profile').status, 'Awaiting activation');
  } finally { f.close(); }
});

test('pending dashboard profiles do not cause a browser analytics request', async () => {
  const f = fixture();
  try {
    const dashboard = await f.service.getCustomerDashboard('customer-1');
    const pending = dashboard.profiles.filter((profile) => profile.id === 'pending-profile');
    const elements = new Map();
    const requested = [];
    const document = {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, { hidden: false, value: '', setAttribute() {}, addEventListener() {} });
        return elements.get(selector);
      },
      querySelectorAll: () => [],
    };
    await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../storefront/public/dashboard.js'), 'utf8'), {
      document, StorefrontModel: require('../storefront/public/model'), location: {},
      fetch: async (url) => {
        requested.push(url);
        return { ok: true, json: async () => url === '/api/session' ? { customerId: 'customer-1', csrfToken: 'token' }
          : url === '/api/dashboard' ? { profiles: pending } : { points: [], summary: {} } };
      },
    });
    assert.deepEqual(requested, ['/api/session', '/api/dashboard']);
    assert.equal(elements.get('#usage-history').hidden, false);
    assert.equal(elements.get('#usage-state').textContent, 'Usage history will be available after this device is activated.');
  } finally { f.close(); }
});

test('customer history is limited to owned, eligible, activated profiles', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.service.getCustomerHistory({ customerId: 'customer-1', profileId: 'profile-1', range: '1d' }), {
      range: '1d', timezone: 'UTC', points: [], summary: { uploadedBytes: 9 },
    });
    for (const profileId of ['profile-2', 'legacy-profile', 'disabled-profile', 'pending-profile', 'missing-profile']) {
      await assert.rejects(f.service.getCustomerHistory({ customerId: 'customer-1', profileId, range: '1d' }),
        (error) => error.status === 404);
    }
    await assert.rejects(f.service.getCustomerHistory({ customerId: 'customer-1', profileId: 'profile-1', range: '2d' }),
      (error) => error.status === 400);
  } finally { f.close(); }
});

test('customer history hides analytics failures as a service outage', async () => {
  const f = fixture({ statusFailure: true });
  try {
    await assert.rejects(f.service.getCustomerHistory({ customerId: 'customer-1', profileId: 'profile-1', range: '1d' }),
      (error) => error.status === 503 && error.code === 'ANALYTICS_UNAVAILABLE' && !error.message.includes('database path'));
  } finally { f.close(); }
});

test('tracking hides internal status failures behind a safe code', async () => {
  const f = fixture({ statusFailure: true });
  try {
    await assert.rejects(f.service.getCustomerDashboard('customer-1'),
      (error) => error.code === 'STATUS_TEMPORARILY_UNAVAILABLE' && !error.message.includes('socket'));
  } finally { f.close(); }
});
