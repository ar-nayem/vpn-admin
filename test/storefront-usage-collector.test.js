const test = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase } = require('../storefront/db/database');
const { createUsageHistoryRepository } = require('../storefront/repositories/usage-history');
const { createUsageCollector } = require('../storefront/services/usage-collector');

function withDatabase(run) {
  const db = openDatabase(':memory:');
  db.prepare(`INSERT INTO customers (id, email, normalized_email, name, created_at)
    VALUES ('customer-1', 'buyer@example.com', 'buyer@example.com', 'Buyer', '2026-10-09T00:00:00.000Z')`).run();
  const insertProfile = db.prepare(`INSERT INTO vpn_profiles
    (id, customer_id, code_name, normalized_code_name, state, device_id, created_at, analytics_enabled)
    VALUES (@id, 'customer-1', @id, @id, 'active', @deviceId, '2026-10-09T00:00:00.000Z', @analyticsEnabled)`);
  insertProfile.run({ id: 'eligible', deviceId: 'device-eligible', analyticsEnabled: 1 });
  insertProfile.run({ id: 'legacy', deviceId: 'device-legacy', analyticsEnabled: 0 });
  try {
    run(db);
  } finally {
    db.close();
  }
}

test('repository lists only opted-in profiles with device mappings', () => {
  withDatabase((db) => {
    db.prepare(`INSERT INTO vpn_profiles
      (id, customer_id, code_name, normalized_code_name, state, created_at, analytics_enabled)
      VALUES ('no-device', 'customer-1', 'No device', 'no-device', 'active', '2026-10-09T00:00:00.000Z', 1)`).run();
    const usage = createUsageHistoryRepository(db);

    assert.deepEqual(usage.listEligibleProfiles(), [{ id: 'eligible', device_id: 'device-eligible', pubkey: null }]);
  });
});

test('reconciliation enables existing profiles and creates admin-only profiles for unmapped active peers', () => {
  withDatabase((db) => {
    db.prepare("UPDATE vpn_profiles SET pubkey = 'existing-key' WHERE id = 'legacy'").run();
    const usage = createUsageHistoryRepository(db);

    assert.deepEqual(usage.reconcileActivePeers([
      { userNumber: 1, userName: 'Previous client', deviceId: 'device-legacy', deviceName: 'Phone', pubkey: 'existing-key', ip: '10.66.67.2', enabled: false, archivedAt: '2026-10-09T00:00:00.000Z' },
      { userNumber: 2, userName: 'User 2', deviceId: 'legacy-2', deviceName: 'Existing device', pubkey: 'unmapped-key', ip: '10.66.67.3', enabled: true },
      { userNumber: 3, deviceId: 'legacy-3', pubkey: 'archived-key', enabled: true, archivedAt: '2026-10-10T00:00:00.000Z' },
    ], '2026-10-10T06:00:00.000Z'), { enabled: 1, created: 1 });

    assert.equal(db.prepare("SELECT analytics_enabled FROM vpn_profiles WHERE id = 'legacy'").get().analytics_enabled, 1);
    const created = db.prepare("SELECT p.code_name, p.device_id, p.pubkey, p.analytics_enabled, c.name, c.normalized_email FROM vpn_profiles p JOIN customers c ON c.id = p.customer_id WHERE p.pubkey = 'unmapped-key'").get();
    assert.deepEqual(created, {
      code_name: 'User 2 · Existing device', device_id: 'legacy-2', pubkey: 'unmapped-key', analytics_enabled: 1,
      name: 'Existing VPN clients', normalized_email: 'legacy-clients@internal.invalid',
    });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM vpn_profiles WHERE pubkey = 'archived-key'").get().count, 0);
  });
});

test('repository inserts each profile minute once and returns its raw counters as the next baseline', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    const sample = {
      profileId: 'eligible', sampledMinute: '2026-10-09T14:32:00.000Z',
      uploadKbps: 2, downloadKbps: 3, uploadedBytes: 20, downloadedBytes: 30, connected: 1,
      rawRxBytes: 20, rawTxBytes: 30,
    };

    assert.equal(usage.insertMinuteSample(sample), true);
    assert.equal(usage.insertMinuteSample({ ...sample, downloadedBytes: 999 }), false);
    assert.deepEqual(usage.findPreviousCounters('eligible'), { rxBytes: 20, txBytes: 30 });
    assert.deepEqual(db.prepare('SELECT * FROM usage_samples_minute').get(), {
      profile_id: 'eligible', sampled_minute: sample.sampledMinute, upload_kbps: 2,
      download_kbps: 3, uploaded_bytes: 20, downloaded_bytes: 30,
      raw_rx_bytes: 20, raw_tx_bytes: 30, connected: 1,
    });
  });
});

test('repository returns counters from the immediately previous sample', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    usage.insertMinuteSample({
      profileId: 'eligible', sampledMinute: '2026-10-09T14:31:00.000Z',
      uploadKbps: 1, downloadKbps: 2, uploadedBytes: 70, downloadedBytes: 90,
      rawRxBytes: 700, rawTxBytes: 900, connected: 1,
    });
    usage.insertMinuteSample({
      profileId: 'eligible', sampledMinute: '2026-10-09T14:32:00.000Z',
      uploadKbps: 1, downloadKbps: 2, uploadedBytes: 20, downloadedBytes: 30,
      rawRxBytes: 20, rawTxBytes: 30, connected: 1,
    });

    assert.deepEqual(usage.findPreviousCounters('eligible'), { rxBytes: 20, txBytes: 30 });
  });
});

test('collector ignores legacy profiles and eligible profiles without a matching snapshot row', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    const collector = createUsageCollector({ usageHistory: usage, now: () => new Date('2026-10-09T14:32:05.000Z') });

    collector.record([
      { deviceId: 'device-legacy', txBytesTotal: 200, rxBytesTotal: 100, connected: true },
      { deviceId: 'unmanaged-device', txBytesTotal: 300, rxBytesTotal: 150, connected: true },
    ]);

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_samples_minute').get().count, 0);
  });
});

test('collector maps server counters and rates to customer directions and stores one UTC minute sample', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    const collector = createUsageCollector({ usageHistory: usage, now: () => new Date('2026-10-09T14:32:05.000Z') });
    const snapshot = [{
      deviceId: 'device-eligible', txBytesTotal: 5_000, rxBytesTotal: 2_000,
      liveDownKbps: 41, liveUpKbps: 13, connected: true,
    }];

    assert.equal(collector.record(snapshot), 1);
    assert.equal(collector.record(snapshot), 0);
    assert.deepEqual(db.prepare('SELECT * FROM usage_samples_minute').get(), {
      profile_id: 'eligible', sampled_minute: '2026-10-09T14:32:00.000Z',
      upload_kbps: 13, download_kbps: 41, uploaded_bytes: 0, downloaded_bytes: 0,
      raw_rx_bytes: 2_000, raw_tx_bytes: 5_000, connected: 1,
    });
  });
});

test('collector starts history for an existing unmapped peer without counting traffic from before tracking began', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    const collector = createUsageCollector({ usageHistory: usage, now: () => new Date('2026-10-10T06:02:05.000Z') });
    const snapshot = [{
      userNumber: 7, userName: 'User 7', deviceId: 'legacy-7', deviceName: 'Existing device',
      pubkey: 'legacy-public-key', ip: '10.66.67.8', enabled: true,
      txBytesTotal: 9_000_000, rxBytesTotal: 4_000_000, liveDownKbps: 900, liveUpKbps: 400, connected: true,
    }];

    assert.equal(collector.record(snapshot), 1);
    const profile = db.prepare("SELECT id, analytics_enabled FROM vpn_profiles WHERE pubkey = 'legacy-public-key'").get();
    assert.equal(profile.analytics_enabled, 1);
    assert.deepEqual(db.prepare('SELECT uploaded_bytes, downloaded_bytes, raw_rx_bytes, raw_tx_bytes FROM usage_samples_minute WHERE profile_id = ?').get(profile.id), {
      uploaded_bytes: 0, downloaded_bytes: 0, raw_rx_bytes: 4_000_000, raw_tx_bytes: 9_000_000,
    });
  });
});

test('collector clamps reset counters and negative or invalid measurements to zero', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    usage.insertMinuteSample({
      profileId: 'eligible', sampledMinute: '2026-10-09T14:31:00.000Z',
      uploadKbps: 0, downloadKbps: 0, uploadedBytes: 500, downloadedBytes: 900, connected: 1,
      rawRxBytes: 500, rawTxBytes: 900,
    });
    const collector = createUsageCollector({ usageHistory: usage, now: () => new Date('2026-10-09T14:32:05.000Z') });

    collector.record([{
      deviceId: 'device-eligible', txBytesTotal: 100, rxBytesTotal: -50,
      liveDownKbps: -4, liveUpKbps: Number.NaN, connected: false,
    }]);

    assert.deepEqual(db.prepare('SELECT * FROM usage_samples_minute WHERE sampled_minute = ?').get('2026-10-09T14:32:00.000Z'), {
      profile_id: 'eligible', sampled_minute: '2026-10-09T14:32:00.000Z',
      upload_kbps: 0, download_kbps: 0, uploaded_bytes: 0, downloaded_bytes: 0,
      raw_rx_bytes: 0, raw_tx_bytes: 100, connected: 0,
    });
  });
});

test('collector resumes deltas from the reset baseline after a zero reset interval', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    let minute = 30;
    const collector = createUsageCollector({
      usageHistory: usage,
      now: () => new Date(`2026-10-09T14:${String(minute).padStart(2, '0')}:05.000Z`),
    });

    collector.record([{ deviceId: 'device-eligible', rxBytesTotal: 9_000, txBytesTotal: 12_000 }]);
    minute += 1;
    collector.record([{ deviceId: 'device-eligible', rxBytesTotal: 100, txBytesTotal: 150 }]);
    minute += 1;
    collector.record([{ deviceId: 'device-eligible', rxBytesTotal: 125, txBytesTotal: 170 }]);

    const samples = db.prepare(`SELECT sampled_minute, uploaded_bytes, downloaded_bytes, raw_rx_bytes, raw_tx_bytes
      FROM usage_samples_minute ORDER BY sampled_minute`).all();
    assert.deepEqual(samples, [
      { sampled_minute: '2026-10-09T14:30:00.000Z', uploaded_bytes: 0, downloaded_bytes: 0, raw_rx_bytes: 9_000, raw_tx_bytes: 12_000 },
      { sampled_minute: '2026-10-09T14:31:00.000Z', uploaded_bytes: 0, downloaded_bytes: 0, raw_rx_bytes: 100, raw_tx_bytes: 150 },
      { sampled_minute: '2026-10-09T14:32:00.000Z', uploaded_bytes: 25, downloaded_bytes: 20, raw_rx_bytes: 125, raw_tx_bytes: 170 },
    ]);
  });
});

test('collector marks a sample connected only when snapshot says currently connected', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    const collector = createUsageCollector({ usageHistory: usage, now: () => new Date('2026-10-09T14:32:05.000Z') });

    collector.record([{ deviceId: 'device-eligible', txBytesTotal: 1, rxBytesTotal: 1, connected: false }]);

    assert.equal(db.prepare('SELECT connected FROM usage_samples_minute').get().connected, 0);
  });
});
