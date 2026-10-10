const crypto = require('node:crypto');

const LEGACY_CUSTOMER_ID = 'internal-legacy-vpn-clients';

function createUsageHistoryRepository(db) {
  const eligibleProfilesStatement = db.prepare(`
    SELECT id, device_id, pubkey
    FROM vpn_profiles
    WHERE analytics_enabled = 1 AND device_id IS NOT NULL
    ORDER BY id
  `);
  const mappedProfileStatement = db.prepare(`
    SELECT id, state, analytics_enabled FROM vpn_profiles
    WHERE device_id = @deviceId OR pubkey = @pubkey
    ORDER BY CASE WHEN pubkey = @pubkey THEN 0 ELSE 1 END LIMIT 1
  `);
  const enableProfileStatement = db.prepare(`
    UPDATE vpn_profiles SET analytics_enabled = 1, updated_at = @updatedAt
    WHERE id = @id AND state = 'active' AND analytics_enabled = 0
  `);
  const ensureLegacyCustomerStatement = db.prepare(`
    INSERT OR IGNORE INTO customers (id, email, normalized_email, name, created_at)
    VALUES (@id, @email, @email, @name, @createdAt)
  `);
  const insertLegacyProfileStatement = db.prepare(`
    INSERT OR IGNORE INTO vpn_profiles
      (id, customer_id, code_name, normalized_code_name, state, device_id, pubkey, ip,
       plan_name, quota_bytes, down_kbps, up_kbps, expires_at, created_at,
       analytics_enabled, delivery_filename)
    VALUES
      (@id, @customerId, @codeName, @normalizedCodeName, 'active', @deviceId, @pubkey, @ip,
       @planName, @quotaBytes, @downKbps, @upKbps, @expiresAt, @createdAt, 1, NULL)
  `);
  const insertMinuteSampleStatement = db.prepare(`
    INSERT OR IGNORE INTO usage_samples_minute
      (profile_id, sampled_minute, upload_kbps, download_kbps, uploaded_bytes, downloaded_bytes,
       raw_rx_bytes, raw_tx_bytes, connected)
    VALUES
      (@profileId, @sampledMinute, @uploadKbps, @downloadKbps, @uploadedBytes, @downloadedBytes,
       @rawRxBytes, @rawTxBytes, @connected)
  `);
  const previousCountersStatement = db.prepare(`
    SELECT raw_rx_bytes AS rxBytes, raw_tx_bytes AS txBytes
    FROM usage_samples_minute
    WHERE profile_id = ?
    ORDER BY sampled_minute DESC
    LIMIT 1
  `);
  const rollupRowsStatement = db.prepare(`
    SELECT profile_id AS profileId, strftime('%Y-%m-%dT%H:00:00.000Z', sampled_minute) AS sampledHour,
      AVG(upload_kbps) AS avgUploadKbps, MAX(upload_kbps) AS peakUploadKbps,
      AVG(download_kbps) AS avgDownloadKbps, MAX(download_kbps) AS peakDownloadKbps,
      SUM(uploaded_bytes) AS uploadedBytes, SUM(downloaded_bytes) AS downloadedBytes,
      SUM(connected) AS connectedMinutes, COUNT(*) AS sampleCount
    FROM usage_samples_minute
    WHERE sampled_minute < ?
    GROUP BY profile_id, strftime('%Y-%m-%dT%H:00:00.000Z', sampled_minute)
    ORDER BY sampledHour, profileId
  `);
  const findHourlyStatement = db.prepare(`
    SELECT 1 FROM usage_samples_hour WHERE profile_id = ? AND sampled_hour = ?
  `);
  const upsertHourlyStatement = db.prepare(`
    INSERT INTO usage_samples_hour
      (profile_id, sampled_hour, avg_upload_kbps, peak_upload_kbps, avg_download_kbps, peak_download_kbps,
       uploaded_bytes, downloaded_bytes, connected_minutes, sample_count)
    VALUES (@profileId, @sampledHour, @avgUploadKbps, @peakUploadKbps, @avgDownloadKbps, @peakDownloadKbps,
       @uploadedBytes, @downloadedBytes, @connectedMinutes, @sampleCount)
    ON CONFLICT(profile_id, sampled_hour) DO UPDATE SET
      avg_upload_kbps = excluded.avg_upload_kbps, peak_upload_kbps = excluded.peak_upload_kbps,
      avg_download_kbps = excluded.avg_download_kbps, peak_download_kbps = excluded.peak_download_kbps,
      uploaded_bytes = excluded.uploaded_bytes, downloaded_bytes = excluded.downloaded_bytes,
      connected_minutes = excluded.connected_minutes, sample_count = excluded.sample_count
  `);
  const pruneRawStatement = db.prepare(`
    DELETE FROM usage_samples_minute AS raw
    WHERE raw.sampled_minute < ? AND EXISTS (
      SELECT 1 FROM usage_samples_hour AS aggregate
      WHERE aggregate.profile_id = raw.profile_id
        AND aggregate.sampled_hour = strftime('%Y-%m-%dT%H:00:00.000Z', raw.sampled_minute)
    )
  `);
  const listMinutesStatement = db.prepare(`
    SELECT profile_id AS profileId, sampled_minute AS timestamp,
      upload_kbps AS uploadKbps, download_kbps AS downloadKbps,
      uploaded_bytes AS uploadedBytes, downloaded_bytes AS downloadedBytes,
      connected AS connectedMinutes
    FROM usage_samples_minute
    WHERE profile_id = ? AND sampled_minute >= ? AND sampled_minute <= ?
    ORDER BY sampled_minute
  `);
  const listAllMinutesStatement = db.prepare(`
    SELECT profile_id AS profileId, sampled_minute AS timestamp,
      upload_kbps AS uploadKbps, download_kbps AS downloadKbps,
      uploaded_bytes AS uploadedBytes, downloaded_bytes AS downloadedBytes,
      connected AS connectedMinutes
    FROM usage_samples_minute WHERE profile_id = ? ORDER BY sampled_minute
  `);
  const listMinutesBeforeStatement = db.prepare(`
    SELECT profile_id AS profileId, sampled_minute AS timestamp,
      upload_kbps AS uploadKbps, download_kbps AS downloadKbps,
      uploaded_bytes AS uploadedBytes, downloaded_bytes AS downloadedBytes,
      connected AS connectedMinutes
    FROM usage_samples_minute WHERE profile_id = ? AND sampled_minute <= ? ORDER BY sampled_minute
  `);
  const listHoursStatement = db.prepare(`
    SELECT profile_id AS profileId, sampled_hour AS timestamp,
      avg_upload_kbps AS avgUploadKbps, peak_upload_kbps AS peakUploadKbps,
      avg_download_kbps AS avgDownloadKbps, peak_download_kbps AS peakDownloadKbps,
      uploaded_bytes AS uploadedBytes, downloaded_bytes AS downloadedBytes,
      connected_minutes AS connectedMinutes, sample_count AS sampleCount
    FROM usage_samples_hour
    WHERE profile_id = ? AND sampled_hour >= ? AND sampled_hour <= ?
    ORDER BY sampled_hour
  `);
  const listAllHoursStatement = db.prepare(`
    SELECT profile_id AS profileId, sampled_hour AS timestamp,
      avg_upload_kbps AS avgUploadKbps, peak_upload_kbps AS peakUploadKbps,
      avg_download_kbps AS avgDownloadKbps, peak_download_kbps AS peakDownloadKbps,
      uploaded_bytes AS uploadedBytes, downloaded_bytes AS downloadedBytes,
      connected_minutes AS connectedMinutes, sample_count AS sampleCount
    FROM usage_samples_hour WHERE profile_id = ? ORDER BY sampled_hour
  `);
  const listHoursBeforeStatement = db.prepare(`
    SELECT profile_id AS profileId, sampled_hour AS timestamp,
      avg_upload_kbps AS avgUploadKbps, peak_upload_kbps AS peakUploadKbps,
      avg_download_kbps AS avgDownloadKbps, peak_download_kbps AS peakDownloadKbps,
      uploaded_bytes AS uploadedBytes, downloaded_bytes AS downloadedBytes,
      connected_minutes AS connectedMinutes, sample_count AS sampleCount
    FROM usage_samples_hour WHERE profile_id = ? AND sampled_hour <= ? ORDER BY sampled_hour
  `);
  const rollupTransaction = db.transaction(({ completedHour, pruneBefore }) => {
    const rows = rollupRowsStatement.all(completedHour);
    let inserted = 0;
    for (const row of rows) {
      if (!findHourlyStatement.get(row.profileId, row.sampledHour)) inserted += 1;
      upsertHourlyStatement.run(row);
    }
    for (const row of rows) {
      if (!findHourlyStatement.get(row.profileId, row.sampledHour)) {
        throw new Error('Usage hour aggregate was not persisted');
      }
    }
    pruneRawStatement.run(pruneBefore);
    return inserted;
  });
  const reconcileTransaction = db.transaction((snapshot, createdAt) => {
    let enabled = 0;
    let created = 0;
    let customerReady = false;
    for (const row of snapshot) {
      if (!row || !row.deviceId || !row.pubkey) continue;
      const mapped = mappedProfileStatement.get({ deviceId: row.deviceId, pubkey: row.pubkey });
      if (mapped) {
        enabled += enableProfileStatement.run({ id: mapped.id, updatedAt: createdAt }).changes;
        continue;
      }
      if (row.archivedAt || row.enabled === false) continue;
      if (!customerReady) {
        ensureLegacyCustomerStatement.run({
          id: LEGACY_CUSTOMER_ID,
          email: 'legacy-clients@internal.invalid',
          name: 'Existing VPN clients',
          createdAt,
        });
        customerReady = true;
      }
      const digest = crypto.createHash('sha256').update(row.pubkey).digest('hex');
      const userName = String(row.userName || `User ${Number(row.userNumber) || ''}`).trim() || 'Existing client';
      const deviceName = String(row.deviceName || 'Existing device').trim() || 'Existing device';
      created += insertLegacyProfileStatement.run({
        id: `legacy-usage-${digest.slice(0, 32)}`,
        customerId: LEGACY_CUSTOMER_ID,
        codeName: `${userName} · ${deviceName}`,
        normalizedCodeName: `legacy-${digest}`,
        deviceId: row.deviceId,
        pubkey: row.pubkey,
        ip: row.ip || null,
        planName: 'Existing VPN',
        quotaBytes: row.quotaBytes || null,
        downKbps: row.downLimitKbps || 0,
        upKbps: row.upLimitKbps || 0,
        expiresAt: row.expiresAt || null,
        createdAt,
      }).changes;
    }
    return { enabled, created };
  });

  return {
    reconcileActivePeers(snapshot, now = new Date().toISOString()) {
      const createdAt = new Date(now);
      if (!Number.isFinite(createdAt.getTime())) throw new TypeError('now must be a valid date');
      return reconcileTransaction(Array.isArray(snapshot) ? snapshot : [], createdAt.toISOString());
    },
    listEligibleProfiles() {
      return eligibleProfilesStatement.all();
    },
    insertMinuteSample(sample) {
      return insertMinuteSampleStatement.run(sample).changes === 1;
    },
    findPreviousCounters(profileId) {
      return previousCountersStatement.get(profileId) || null;
    },
    rollupCompletedHours(now = new Date(), retentionDays = 30) {
      const date = now instanceof Date ? now : new Date(now);
      if (!Number.isFinite(date.getTime())) throw new TypeError('now must be a valid date');
      const hour = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
      const completedHour = new Date(hour).toISOString();
      const retentionCutoff = new Date(date.getTime() - Math.max(0, Number(retentionDays) || 0) * 86400000);
      const pruneBefore = new Date(Date.UTC(
        retentionCutoff.getUTCFullYear(), retentionCutoff.getUTCMonth(), retentionCutoff.getUTCDate(), retentionCutoff.getUTCHours(),
      )).toISOString();
      return rollupTransaction({ completedHour, pruneBefore });
    },
    listMinuteSamples(profileId, from, to) {
      if (from === undefined) return to === undefined ? listAllMinutesStatement.all(profileId) : listMinutesBeforeStatement.all(profileId, to);
      return listMinutesStatement.all(profileId, from, to);
    },
    listHourlySamples(profileId, from, to) {
      if (from === undefined) return to === undefined ? listAllHoursStatement.all(profileId) : listHoursBeforeStatement.all(profileId, to);
      return listHoursStatement.all(profileId, from, to);
    },
    hasHourlySample(profileId, sampledHour) {
      return Boolean(findHourlyStatement.get(profileId, sampledHour));
    },
  };
}

module.exports = { createUsageHistoryRepository };
