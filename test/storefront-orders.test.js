const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createProfileRepository } = require('../storefront/repositories/profiles');
const { createCustomerRepository } = require('../storefront/repositories/customers');
const { createProfileService } = require('../storefront/services/profiles');
const { createOrderRepository } = require('../storefront/repositories/orders');
const { createSettingsRepository } = require('../storefront/repositories/settings');
const { createOrderService, createQrService } = require('../storefront/services/orders');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-orders-'));
  const db = openDatabase(path.join(directory, 'storefront.db'));
  const timestamp = '2026-10-08T00:00:00.000Z';
  db.prepare('INSERT INTO customers (id,email,normalized_email,name,verified_at,created_at) VALUES (?,?,?,?,?,?)')
    .run('customer-1', 'owner@example.com', 'owner@example.com', 'Owner', timestamp, timestamp);
  db.prepare(`INSERT INTO vpn_profiles
    (id,customer_id,code_name,normalized_code_name,state,device_id,plan_id,plan_name,quota_bytes,down_kbps,up_kbps,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('profile-1', 'customer-1', 'Phone', 'phone', 'active', 'device-1', 'trial', 'Free trial', 1024 ** 3, 5120, 5120, timestamp);
  let stored = 0;
  let removed = 0;
  let ids = 0;
  const orders = createOrderRepository(db);
  const service = createOrderService({
    db, orders, profiles: createProfileRepository(db),
    verification: { consumeGrant: ({ email, grant }) => email === 'owner@example.com' && grant === 'valid' },
    proofStorage: {
      async store() { stored += 1; return { filename: `proof-${stored}.png` }; },
      async remove() { removed += 1; },
    },
    now: () => new Date(timestamp), randomUUID: () => `order-${++ids}`,
  });
  return { db, orders, service, stored: () => stored, removed: () => removed,
    close() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

function profileService(db) {
  return createProfileService({
    db, customers: createCustomerRepository(db), profiles: createProfileRepository(db),
    verification: { consumeGrant: () => true },
    now: () => new Date('2026-10-08T00:00:00.000Z'),
  });
}

test('opts a newly created registered paid profile into analytics with a customer delivery filename', () => {
  const f = fixture();
  try {
    f.db.prepare('INSERT INTO customers (id,email,normalized_email,name,password_hash,created_at) VALUES (?,?,?,?,?,?)')
      .run('registered-customer', 'nayem@example.com', 'nayem@example.com', 'Nayem Ahmed', 'password-hash', '2026-10-08T00:00:00.000Z');
    const created = profileService(f.db).createPaidProfile('registered-customer', 'iPhone');
    const row = f.db.prepare('SELECT * FROM vpn_profiles WHERE id = ?').get(created.id);
    assert.equal(row.analytics_enabled, 1);
    assert.equal(row.delivery_filename, 'Nayem-Ahmed-iPhone.conf');
    const legacy = f.db.prepare('SELECT * FROM vpn_profiles WHERE id = ?').get('profile-1');
    assert.equal(legacy.analytics_enabled, 0);
    assert.equal(legacy.delivery_filename, null);
  } finally { f.close(); }
});

test('opts a newly created guest paid profile into analytics with a customer delivery filename', () => {
  const f = fixture();
  try {
    const created = profileService(f.db).createGuestPaidProfile({
      name: 'Nayem Ahmed', email: 'NAYEM@example.com', codeName: 'iPhone', verificationGrant: 'valid',
    });
    const row = f.db.prepare('SELECT * FROM vpn_profiles WHERE id = ?').get(created.profile.id);
    assert.equal(row.analytics_enabled, 1);
    assert.equal(row.delivery_filename, 'Nayem-Ahmed-iPhone.conf');
  } finally { f.close(); }
});

test('stores distinct stable filenames for a customer whose device code names sanitize identically', () => {
  const f = fixture();
  try {
    const service = profileService(f.db);
    const created = ['iPhone', 'iPhone.', 'iPhone--'].map((codeName) => service.createPaidProfile('customer-1', codeName));
    const readFilenames = () => created.map(({ id }) => f.db.prepare('SELECT delivery_filename FROM vpn_profiles WHERE id = ?').get(id).delivery_filename);
    const names = readFilenames();
    assert.equal(names[0], 'Owner-iPhone.conf');
    assert.equal(new Set(names).size, 3);
    assert.match(names[1], /^Owner-iPhone-[a-z0-9]{8,}\.conf$/);
    assert.match(names[2], /^Owner-iPhone-[a-z0-9]{8,}\.conf$/);
    f.db.prepare('UPDATE customers SET name = ? WHERE id = ?').run('Changed name', 'customer-1');
    assert.deepEqual(readFilenames(), names);

    const other = service.createGuestPaidProfile({ name: 'Owner', email: 'different@example.com', codeName: 'iPhone', verificationGrant: 'valid' });
    assert.equal(other.profile.delivery_filename, 'Owner-iPhone.conf');
    assert.equal(f.db.prepare('SELECT delivery_filename FROM vpn_profiles WHERE id = ?').get('profile-1').delivery_filename, null);
  } finally { f.close(); }
});

test('long customer names keep device and collision suffixes within the 96-character basename', () => {
  const f = fixture();
  try {
    f.db.prepare('UPDATE customers SET name = ? WHERE id = ?').run('𐐀'.repeat(120), 'customer-1');
    const service = profileService(f.db);
    const ids = ['Personal iPhone', 'Personal iPhone.', 'Personal iPad'].map((codeName) => service.createPaidProfile('customer-1', codeName).id);
    const filenames = ids.map((id) => f.db.prepare('SELECT delivery_filename FROM vpn_profiles WHERE id = ?').get(id).delivery_filename);
    assert.equal(new Set(filenames).size, 3);
    for (const filename of filenames) assert.ok(Array.from(filename.slice(0, -5)).length <= 96);
    assert.match(filenames[0], /-Personal-iPhone\.conf$/);
    assert.match(filenames[1], /-Personal-iPhone-[a-z0-9]{8,}\.conf$/);
    assert.match(filenames[2], /-Personal-iPad\.conf$/);
  } finally { f.close(); }
});

test('reusing a legacy guest paid profile preserves its complete row', () => {
  const f = fixture();
  try {
    const before = f.db.prepare('SELECT * FROM vpn_profiles WHERE id = ?').get('profile-1');
    const reused = profileService(f.db).createGuestPaidProfile({
      name: 'Nayem Ahmed', email: 'owner@example.com', codeName: 'Phone', verificationGrant: 'valid',
    });
    assert.equal(reused.profile.id, 'profile-1');
    assert.deepEqual(f.db.prepare('SELECT * FROM vpn_profiles WHERE id = ?').get('profile-1'), before);
  } finally { f.close(); }
});

test('submits an owned paid order using only server-calculated package values', async () => {
  const f = fixture();
  try {
    const order = await f.service.submitOrder({
      customerId: 'customer-1', profileId: 'profile-1', planId: 'basic', months: 3,
      paymentMethod: 'wechat', proof: { buffer: Buffer.from('ignored') },
      priceCny: 1, quotaBytes: 1,
    });
    assert.equal(order.state, 'pending');
    assert.equal(order.price_cny, 15);
    assert.equal(order.quota_bytes, 180 * 1024 ** 3);
    assert.equal(order.down_kbps, 5120);
    assert.equal(order.proof_filename, 'proof-1.png');
    await assert.rejects(f.service.submitOrder({
      customerId: 'customer-1', profileId: 'profile-1', planId: 'pro', months: 1,
      paymentMethod: 'alipay', proof: {},
    }), (error) => error.code === 'ORDER_ALREADY_PENDING');
    assert.equal(f.removed(), 1);
  } finally { f.close(); }
});

test('requires proof, valid payment method, and profile ownership', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.submitOrder({ customerId: 'customer-1', profileId: 'profile-1', planId: 'basic', months: 1, paymentMethod: 'wechat' }), /proof/i);
    await assert.rejects(f.service.submitOrder({ customerId: 'customer-1', profileId: 'profile-1', planId: 'basic', months: 1, paymentMethod: 'cash', proof: {} }), /payment/i);
    await assert.rejects(f.service.submitOrder({ customerId: 'other', profileId: 'profile-1', planId: 'basic', months: 1, paymentMethod: 'wechat', proof: {} }), /profile/i);
    assert.equal(f.stored(), 0);
  } finally { f.close(); }
});

test('verified guests can order only for the profile belonging to their email', async () => {
  const f = fixture();
  try {
    const order = await f.service.submitOrder({
      guestGrant: { email: ' OWNER@example.com ', grant: 'valid' }, profileId: 'profile-1',
      planId: 'premium', months: 2, paymentMethod: 'alipay', proof: {},
    });
    assert.equal(order.customer_id, 'customer-1');
  } finally { f.close(); }
});

test('rejects a pending order without touching VPN provisioning', async () => {
  const f = fixture();
  try {
    const order = await f.service.submitOrder({ customerId: 'customer-1', profileId: 'profile-1', planId: 'pro', months: 1, paymentMethod: 'wechat', proof: {} });
    const rejected = f.service.rejectOrder({ orderId: order.id, adminRef: 'admin', reason: 'Proof is unreadable' });
    assert.equal(rejected.state, 'rejected');
    assert.equal(rejected.rejection_reason, 'Proof is unreadable');
    assert.throws(() => f.service.rejectOrder({ orderId: order.id, adminRef: 'admin' }), /state/i);
  } finally { f.close(); }
});

test('QR settings expose availability and remove the previous image after replacement', async () => {
  const f = fixture();
  const removed = [];
  let next = 0;
  try {
    const qr = createQrService({
      db: f.db,
      settings: createSettingsRepository(f.db),
      storage: {
        async store() { next += 1; return { filename: `qr-${next}.png` }; },
        async remove(filename) { removed.push(filename); },
      },
      now: () => new Date('2026-10-08T00:00:00.000Z'),
    });
    assert.deepEqual(qr.getActiveQr('wechat'), { method: 'wechat', available: false });
    await qr.storeQrImage('wechat', {}, 'admin');
    await qr.storeQrImage('wechat', {}, 'admin');
    assert.deepEqual(qr.getActiveQr('wechat'), { method: 'wechat', available: true, filename: 'qr-2.png' });
    assert.deepEqual(removed, ['qr-1.png']);
  } finally { f.close(); }
});
