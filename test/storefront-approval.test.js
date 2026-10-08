const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createProfileRepository } = require('../storefront/repositories/profiles');
const { createOrderRepository } = require('../storefront/repositories/orders');
const { createOrderService } = require('../storefront/services/orders');

function fixture({ existingDevice = true, fail = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-approval-'));
  const db = openDatabase(path.join(directory, 'storefront.db'));
  const now = '2026-10-08T00:00:00.000Z';
  db.prepare('INSERT INTO customers (id,email,normalized_email,name,verified_at,created_at) VALUES (?,?,?,?,?,?)')
    .run('customer-1', 'owner@example.com', 'owner@example.com', 'Owner', now, now);
  db.prepare(`INSERT INTO vpn_profiles
    (id,customer_id,code_name,normalized_code_name,state,device_id,plan_id,plan_name,quota_bytes,down_kbps,up_kbps,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('profile-1', 'customer-1', 'Phone', 'phone', existingDevice ? 'active' : 'pending', existingDevice ? 'device-1' : null, 'trial', 'Free trial', 1024 ** 3, 5120, 5120, now);
  db.prepare(`INSERT INTO orders
    (id,customer_id,profile_id,state,plan_id,plan_name,months,price_cny,quota_bytes,down_kbps,up_kbps,payment_method,proof_filename,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('order-1', 'customer-1', 'profile-1', 'pending', 'premium', 'Premium', 2, 20, 240 * 1024 ** 3, 0, 0, 'wechat', 'proof.png', now);
  const calls = [];
  let shouldFail = fail;
  const provisioning = {
    async upgrade(deviceId, input) {
      calls.push(['upgrade', deviceId, input]);
      if (shouldFail) throw new Error('private upstream detail');
      return { deviceId, pubkey: 'public-1', ip: '10.0.0.2', planId: 'premium', planName: 'Premium', quotaBytes: 240 * 1024 ** 3, downKbps: 0, upKbps: 0, expiresAt: '2026-12-08T00:00:00.000Z' };
    },
    async createPaid(input) {
      calls.push(['create', input]);
      if (shouldFail) throw new Error('private upstream detail');
      return { deviceId: 'device-new', pubkey: 'public-new', ip: '10.0.0.3', planId: 'premium', planName: 'Premium', quotaBytes: 240 * 1024 ** 3, downKbps: 0, upKbps: 0, expiresAt: '2026-12-08T00:00:00.000Z' };
    },
  };
  const service = createOrderService({
    db, orders: createOrderRepository(db), profiles: createProfileRepository(db), provisioning,
    verification: {}, proofStorage: {}, now: () => new Date(now), randomUUID: () => 'unused',
  });
  return { db, service, calls, recover() { shouldFail = false; }, close() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('approval upgrades an existing trial in place and is idempotent', async () => {
  const f = fixture();
  try {
    const result = await f.service.approveOrder({ orderId: 'order-1', adminRef: 'admin' });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].slice(0, 2), ['upgrade', 'device-1']);
    assert.equal(result.order.state, 'approved');
    assert.equal(result.profile.device_id, 'device-1');
    assert.equal(result.profile.quota_bytes, 240 * 1024 ** 3);
    await f.service.approveOrder({ orderId: 'order-1', adminRef: 'admin' });
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test('approval creates a paid profile when no trial device exists', async () => {
  const f = fixture({ existingDevice: false });
  try {
    const result = await f.service.approveOrder({ orderId: 'order-1', adminRef: 'admin' });
    assert.equal(f.calls[0][0], 'create');
    assert.equal(result.profile.device_id, 'device-new');
  } finally { f.close(); }
});

test('provisioning failure is safely recorded and retry resumes only provisioning', async () => {
  const f = fixture({ fail: true });
  try {
    await assert.rejects(f.service.approveOrder({ orderId: 'order-1', adminRef: 'admin' }),
      (error) => error.code === 'PROVISIONING_FAILED' && !error.message.includes('private'));
    assert.equal(f.db.prepare('SELECT state FROM orders WHERE id = ?').get('order-1').state, 'provisioning_failed');
    f.recover();
    const retried = await f.service.retryProvisioning({ orderId: 'order-1', adminRef: 'admin' });
    assert.equal(retried.order.state, 'approved');
    assert.equal(f.calls.length, 2);
  } finally { f.close(); }
});
