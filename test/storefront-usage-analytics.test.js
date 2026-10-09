const test = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase } = require('../storefront/db/database');
const { createUsageHistoryRepository } = require('../storefront/repositories/usage-history');
const { createUsageAnalyticsService } = require('../storefront/services/usage-analytics');

function withDatabase(run) {
  const db = openDatabase(':memory:');
  db.prepare(`INSERT INTO customers (id, email, normalized_email, name, created_at)
    VALUES ('customer-1', 'buyer@example.com', 'buyer@example.com', 'Buyer', '2026-10-09T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO vpn_profiles
    (id, customer_id, code_name, normalized_code_name, state, device_id, created_at, analytics_enabled)
    VALUES ('profile-1', 'customer-1', 'Phone', 'phone', 'active', 'device-1', '2026-10-09T00:00:00.000Z', 1)`).run();
  try { run(db); } finally { db.close(); }
}

function minute(profileId, sampledMinute, values = {}) {
  return {
    profileId, sampledMinute,
    uploadKbps: 2, downloadKbps: 4, uploadedBytes: 120, downloadedBytes: 240,
    rawRxBytes: 1000, rawTxBytes: 2000, connected: 1, ...values,
  };
}

test('rolls completed UTC hours up deterministically and deletes aged raw rows only after aggregates exist', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    usage.insertMinuteSample(minute('profile-1', '2026-09-01T10:01:00.000Z'));
    usage.insertMinuteSample(minute('profile-1', '2026-09-01T10:59:00.000Z', {
      uploadKbps: 8, downloadKbps: 10, uploadedBytes: 80, downloadedBytes: 160, connected: 0,
    }));
    usage.insertMinuteSample(minute('profile-1', '2026-10-09T14:01:00.000Z'));

    const now = new Date('2026-10-09T15:00:00.000Z');
    assert.equal(usage.rollupCompletedHours(now, 90), 2);
    const first = usage.listHourlySamples('profile-1');
    assert.deepEqual(first, [{
      profileId: 'profile-1', timestamp: '2026-09-01T10:00:00.000Z',
      avgUploadKbps: 5, peakUploadKbps: 8, avgDownloadKbps: 7,
      peakDownloadKbps: 10, uploadedBytes: 200, downloadedBytes: 400,
      connectedMinutes: 1, sampleCount: 2,
    }, {
      profileId: 'profile-1', timestamp: '2026-10-09T14:00:00.000Z',
      avgUploadKbps: 2, peakUploadKbps: 2, avgDownloadKbps: 4,
      peakDownloadKbps: 4, uploadedBytes: 120, downloadedBytes: 240,
      connectedMinutes: 1, sampleCount: 1,
    }]);
    assert.equal(usage.rollupCompletedHours(now, 90), 0);
    assert.deepEqual(usage.listHourlySamples('profile-1'), first);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_samples_minute').get().count, 3);
    assert.equal(usage.rollupCompletedHours(new Date('2026-10-09T15:01:00.000Z'), 30), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_samples_minute').get().count, 1);
  });
});

test('retains raw samples when an hourly aggregate cannot be written', () => {
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    usage.insertMinuteSample(minute('profile-1', '2026-09-01T10:01:00.000Z'));
    db.exec(`CREATE TRIGGER fail_usage_hour BEFORE INSERT ON usage_samples_hour
      BEGIN SELECT RAISE(ABORT, 'aggregate unavailable'); END`);

    assert.throws(() => usage.rollupCompletedHours(new Date('2026-10-09T15:00:00.000Z'), 30), /aggregate unavailable/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_samples_minute').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_samples_hour').get().count, 0);
  });
});

test('returns the bounded range contract, UTC chronological points, and zero summaries for empty history', () => {
  const now = () => new Date('2026-10-09T15:00:00.000Z');
  withDatabase((db) => {
    const analytics = createUsageAnalyticsService({ usageHistory: createUsageHistoryRepository(db), now, timezone: 'Asia/Shanghai' });
    assert.deepEqual(analytics.getProfileHistory('profile-1', '7d'), {
      range: '7d', timezone: 'Asia/Shanghai', points: [],
      summary: { uploadedBytes: 0, downloadedBytes: 0, peakUploadKbps: 0, peakDownloadKbps: 0, connectedMinutes: 0 },
    });
    assert.throws(() => analytics.getProfileHistory('profile-1', '2d'), /range/i);
  });
});

test('supports every requested range with its required granularity and chronological order', () => {
  const now = () => new Date('2026-10-09T15:00:00.000Z');
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    for (const timestamp of [
      '2026-10-09T14:01:00.000Z', '2026-10-09T14:09:00.000Z', '2026-10-09T14:11:00.000Z',
      '2026-10-09T14:59:00.000Z', '2026-10-08T15:01:00.000Z', '2026-10-02T15:00:00.000Z',
      '2026-09-29T15:00:00.000Z', '2026-09-09T15:00:00.000Z',
    ]) usage.insertMinuteSample(minute('profile-1', timestamp));
    const analytics = createUsageAnalyticsService({ usageHistory: usage, now, timezone: 'Asia/Shanghai' });

    const oneHour = analytics.getProfileHistory('profile-1', '1h');
    const oneDay = analytics.getProfileHistory('profile-1', '1d');
    const sevenDays = analytics.getProfileHistory('profile-1', '7d');
    const tenDays = analytics.getProfileHistory('profile-1', '10d');
    const thirtyDays = analytics.getProfileHistory('profile-1', '30d');
    const lifetime = analytics.getProfileHistory('profile-1', 'lifetime');
    for (const result of [oneHour, oneDay, sevenDays, tenDays, thirtyDays, lifetime]) {
      assert.equal(result.timezone, 'Asia/Shanghai');
      assert.deepEqual(result.points.map(({ timestamp }) => timestamp),
        [...result.points.map(({ timestamp }) => timestamp)].sort());
      assert.ok(result.points.every(({ uploadKbps, downloadKbps }) => Number.isFinite(uploadKbps) && uploadKbps >= 0 && Number.isFinite(downloadKbps) && downloadKbps >= 0));
    }
    assert.equal(oneHour.range, '1h');
    assert.ok(oneHour.points.every(({ timestamp }) => Date.parse(timestamp) >= Date.parse('2026-10-09T14:00:00.000Z')));
    assert.ok(oneDay.points.length < oneHour.points.length + 1);
    assert.ok(oneDay.points.some(({ timestamp }) => timestamp === '2026-10-09T14:00:00.000Z'));
    assert.ok(sevenDays.points.some(({ timestamp }) => timestamp === '2026-10-09T14:00:00.000Z'));
    assert.ok(tenDays.points.some(({ timestamp }) => timestamp === '2026-10-09T14:00:00.000Z'));
    assert.ok(thirtyDays.points.some(({ timestamp }) => timestamp === '2026-10-09T12:00:00.000Z'));
    assert.ok(lifetime.points.length <= 240);
    assert.deepEqual(oneDay.summary, {
      uploadedBytes: 600, downloadedBytes: 1200, peakUploadKbps: 2,
      peakDownloadKbps: 4, connectedMinutes: 5,
    });
  });
});

test('caps lifetime history at 240 points', () => {
  const now = () => new Date('2026-10-09T15:00:00.000Z');
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    const insert = db.prepare(`INSERT INTO usage_samples_hour
      (profile_id, sampled_hour, avg_upload_kbps, peak_upload_kbps, avg_download_kbps, peak_download_kbps,
       uploaded_bytes, downloaded_bytes, connected_minutes, sample_count)
      VALUES ('profile-1', ?, 1, 2, 3, 4, 10, 20, 1, 1)`);
    for (let hour = 0; hour < 300; hour += 1) {
      insert.run(new Date(Date.parse('2026-10-09T00:00:00.000Z') - hour * 3600000).toISOString());
    }
    const analytics = createUsageAnalyticsService({ usageHistory: usage, now, timezone: 'UTC' });
    assert.ok(analytics.getProfileHistory('profile-1', 'lifetime').points.length <= 240);
  });
});

test('groups unrolled lifetime minute samples hourly before applying the 240 point cap', () => {
  const now = () => new Date('2026-10-09T15:00:00.000Z');
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    for (let minuteIndex = 1; minuteIndex <= 300; minuteIndex += 1) {
      const timestamp = new Date(Date.parse('2026-10-09T15:00:00.000Z') - minuteIndex * 60000).toISOString();
      usage.insertMinuteSample(minute('profile-1', timestamp));
    }
    const analytics = createUsageAnalyticsService({ usageHistory: usage, now, timezone: 'UTC' });
    const points = analytics.getProfileHistory('profile-1', 'lifetime').points;
    assert.ok(points.length > 1 && points.length <= 6);
  });
});

test('uses raw minute points for the last hour and each rollup once for wider ranges', () => {
  const now = () => new Date('2026-10-09T15:00:00.000Z');
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    usage.insertMinuteSample(minute('profile-1', '2026-10-09T14:10:00.000Z'));
    usage.insertMinuteSample(minute('profile-1', '2026-10-09T14:20:00.000Z'));
    usage.rollupCompletedHours(now());
    const analytics = createUsageAnalyticsService({ usageHistory: usage, now });

    const recent = analytics.getProfileHistory('profile-1', '1h');
    const day = analytics.getProfileHistory('profile-1', '1d');
    assert.equal(recent.points.length, 2);
    assert.equal(recent.summary.uploadedBytes, 240);
    assert.equal(day.points.length, 2);
    assert.equal(day.summary.uploadedBytes, 240);
  });
});

test('retains a complete hour when the retention cutoff falls inside it', () => {
  const now = () => new Date('2026-10-09T16:10:00.000Z');
  withDatabase((db) => {
    const usage = createUsageHistoryRepository(db);
    for (let minuteIndex = 1; minuteIndex <= 20; minuteIndex += 1) {
      const timestamp = `2026-09-09T16:${String(minuteIndex).padStart(2, '0')}:00.000Z`;
      usage.insertMinuteSample(minute('profile-1', timestamp));
    }

    usage.rollupCompletedHours(now());
    const firstAggregate = usage.listHourlySamples('profile-1')[0];
    assert.equal(firstAggregate.sampleCount, 20);
    assert.equal(usage.rollupCompletedHours(now()), 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM usage_samples_minute
      WHERE sampled_minute >= '2026-09-09T16:00:00.000Z'
        AND sampled_minute < '2026-09-09T17:00:00.000Z'`).get().count, 20);
    assert.deepEqual(usage.listHourlySamples('profile-1')[0], firstAggregate);

    const analytics = createUsageAnalyticsService({ usageHistory: usage, now, timezone: 'UTC' });
    assert.equal(analytics.getProfileHistory('profile-1', 'lifetime').summary.uploadedBytes, 20 * 120);
  });
});
