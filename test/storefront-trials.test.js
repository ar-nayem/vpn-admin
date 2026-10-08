const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createCustomerRepository } = require('../storefront/repositories/customers');
const { createProfileRepository } = require('../storefront/repositories/profiles');
const { createTrialService } = require('../storefront/services/trials');

function fixture({ failProvisioning = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-trials-'));
  const db = openDatabase(path.join(directory, 'storefront.db'));
  let calls = 0;
  let ids = 0;
  const provisioning = {
    async createTrial(input) {
      calls += 1;
      if (failProvisioning) throw new Error('private upstream detail');
      return { deviceId: 'device-22', pubkey: 'public-22', ip: '10.66.67.23', ...input.entitlement };
    },
  };
  const service = createTrialService({
    db,
    customers: createCustomerRepository(db),
    profiles: createProfileRepository(db),
    verification: { consumeGrant: () => true },
    provisioning,
    now: () => new Date('2026-10-08T00:00:00.000Z'),
    randomUUID: () => `id-${++ids}`,
  });
  return {
    db,
    service,
    calls: () => calls,
    close() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

test('reserves one automatic trial per normalized email before provisioning', async () => {
  const f = fixture();
  try {
    const inputs = ['Buyer@Example.com', 'buyer@example.com'].map((email) => f.service.startTrial({
      name: 'Buyer', email, codeName: 'Phone', verificationGrant: 'grant',
    }));
    const results = await Promise.allSettled(inputs);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected').reason;
    assert.equal(rejected.code, 'TRIAL_ALREADY_USED');
    assert.equal(f.calls(), 1);
    const profile = f.db.prepare('SELECT * FROM vpn_profiles').get();
    assert.equal(profile.state, 'active');
    assert.equal(profile.quota_bytes, 1024 ** 3);
    assert.equal(profile.down_kbps, 5120);
    assert.equal(profile.up_kbps, 5120);
  } finally { f.close(); }
});

test('failed provisioning releases the trial reservation for retry', async () => {
  const f = fixture({ failProvisioning: true });
  try {
    await assert.rejects(
      f.service.startTrial({ name: 'Buyer', email: 'buyer@example.com', codeName: 'Phone', verificationGrant: 'grant' }),
      (error) => error.code === 'TRIAL_PROVISIONING_FAILED' && !error.message.includes('private upstream')
    );
    const customer = f.db.prepare('SELECT * FROM customers').get();
    assert.equal(customer.trial_consumed_at, null);
    assert.equal(f.db.prepare('SELECT COUNT(*) count FROM vpn_profiles').get().count, 0);
  } finally { f.close(); }
});
