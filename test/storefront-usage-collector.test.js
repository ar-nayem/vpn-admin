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

    assert.deepEqual(usage.listEligibleProfiles(), [{ id: 'eligible', device_id: 'device-eligible' }]);
  });
});

test('repository inserts each profile minute once and derives previous counters from stored deltas', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    const sample = {
      profileId: 'eligible', sampledMinute: '2026-10-09T14:32:00.000Z',
      uploadKbps: 2, downloadKbps: 3, uploadedBytes: 20, downloadedBytes: 30, connected: 1,
    };

    assert.equal(usage.insertMinuteSample(sample), true);
    assert.equal(usage.insertMinuteSample({ ...sample, downloadedBytes: 999 }), false);
    assert.deepEqual(usage.findPreviousCounters('eligible'), { rxBytes: 20, txBytes: 30 });
    assert.deepEqual(db.prepare('SELECT * FROM usage_samples_minute').get(), {
      profile_id: 'eligible', sampled_minute: sample.sampledMinute, upload_kbps: 2,
      download_kbps: 3, uploaded_bytes: 20, downloaded_bytes: 30, connected: 1,
    });
  });
});

test('repository keeps previous counters after minute samples have rolled into an hour', () => {
  withDatabase((db) => {
    db.prepare(`INSERT INTO usage_samples_hour
      (profile_id, sampled_hour, avg_upload_kbps, peak_upload_kbps, avg_download_kbps,
       peak_download_kbps, uploaded_bytes, downloaded_bytes, connected_minutes, sample_count)
      VALUES ('eligible', '2026-10-08T14:00:00.000Z', 1, 1, 2, 2, 70, 90, 1, 1)`).run();
    db.prepare(`INSERT INTO usage_samples_minute
      (profile_id, sampled_minute, upload_kbps, download_kbps, uploaded_bytes, downloaded_bytes, connected)
      VALUES ('eligible', '2026-10-09T14:31:00.000Z', 1, 1, 20, 30, 1)`).run();
    const usage = createUsageHistoryRepository(db);

    assert.deepEqual(usage.findPreviousCounters('eligible'), { rxBytes: 90, txBytes: 120 });
  });
});

test('repository does not count rolled minute rows twice before retention removes them', () => {
  withDatabase((db) => {
    db.prepare(`INSERT INTO usage_samples_hour
      (profile_id, sampled_hour, avg_upload_kbps, peak_upload_kbps, avg_download_kbps,
       peak_download_kbps, uploaded_bytes, downloaded_bytes, connected_minutes, sample_count)
      VALUES ('eligible', '2026-10-09T14:00:00.000Z', 1, 1, 2, 2, 70, 90, 1, 1)`).run();
    db.prepare(`INSERT INTO usage_samples_minute
      (profile_id, sampled_minute, upload_kbps, download_kbps, uploaded_bytes, downloaded_bytes, connected)
      VALUES ('eligible', '2026-10-09T14:31:00.000Z', 1, 1, 70, 90, 1)`).run();
    const usage = createUsageHistoryRepository(db);

    assert.deepEqual(usage.findPreviousCounters('eligible'), { rxBytes: 70, txBytes: 90 });
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
      upload_kbps: 13, download_kbps: 41, uploaded_bytes: 2_000, downloaded_bytes: 5_000, connected: 1,
    });
  });
});

test('collector clamps reset counters and negative or invalid measurements to zero', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    usage.insertMinuteSample({
      profileId: 'eligible', sampledMinute: '2026-10-09T14:31:00.000Z',
      uploadKbps: 0, downloadKbps: 0, uploadedBytes: 500, downloadedBytes: 900, connected: 1,
    });
    const collector = createUsageCollector({ usageHistory: usage, now: () => new Date('2026-10-09T14:32:05.000Z') });

    collector.record([{
      deviceId: 'device-eligible', txBytesTotal: 100, rxBytesTotal: -50,
      liveDownKbps: -4, liveUpKbps: Number.NaN, connected: false,
    }]);

    assert.deepEqual(db.prepare('SELECT * FROM usage_samples_minute WHERE sampled_minute = ?').get('2026-10-09T14:32:00.000Z'), {
      profile_id: 'eligible', sampled_minute: '2026-10-09T14:32:00.000Z',
      upload_kbps: 0, download_kbps: 0, uploaded_bytes: 0, downloaded_bytes: 0, connected: 0,
    });
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
