function createUsageHistoryRepository(db) {
  const eligibleProfilesStatement = db.prepare(`
    SELECT id, device_id
    FROM vpn_profiles
    WHERE analytics_enabled = 1 AND device_id IS NOT NULL
    ORDER BY id
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

  return {
    listEligibleProfiles() {
      return eligibleProfilesStatement.all();
    },
    insertMinuteSample(sample) {
      return insertMinuteSampleStatement.run(sample).changes === 1;
    },
    findPreviousCounters(profileId) {
      return previousCountersStatement.get(profileId) || { rxBytes: 0, txBytes: 0 };
    },
    rollupCompletedHours(now = new Date(), retentionDays = 30) {
      const date = now instanceof Date ? now : new Date(now);
      if (!Number.isFinite(date.getTime())) throw new TypeError('now must be a valid date');
      const hour = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
      const completedHour = new Date(hour).toISOString();
      const pruneBefore = new Date(date.getTime() - Math.max(0, Number(retentionDays) || 0) * 86400000).toISOString();
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
