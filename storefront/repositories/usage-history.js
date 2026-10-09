function createUsageHistoryRepository(db) {
  const eligibleProfilesStatement = db.prepare(`
    SELECT id, device_id
    FROM vpn_profiles
    WHERE analytics_enabled = 1 AND device_id IS NOT NULL
    ORDER BY id
  `);
  const insertMinuteSampleStatement = db.prepare(`
    INSERT OR IGNORE INTO usage_samples_minute
      (profile_id, sampled_minute, upload_kbps, download_kbps, uploaded_bytes, downloaded_bytes, connected)
    VALUES
      (@profileId, @sampledMinute, @uploadKbps, @downloadKbps, @uploadedBytes, @downloadedBytes, @connected)
  `);
  const previousCountersStatement = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(m.uploaded_bytes), 0) FROM usage_samples_minute m
        WHERE m.profile_id = @profileId AND NOT EXISTS (
          SELECT 1 FROM usage_samples_hour h
          WHERE h.profile_id = m.profile_id
            AND h.sampled_hour = substr(m.sampled_minute, 1, 13) || ':00:00.000Z'
        ))
        + (SELECT COALESCE(SUM(uploaded_bytes), 0) FROM usage_samples_hour WHERE profile_id = @profileId) AS rxBytes,
      (SELECT COALESCE(SUM(m.downloaded_bytes), 0) FROM usage_samples_minute m
        WHERE m.profile_id = @profileId AND NOT EXISTS (
          SELECT 1 FROM usage_samples_hour h
          WHERE h.profile_id = m.profile_id
            AND h.sampled_hour = substr(m.sampled_minute, 1, 13) || ':00:00.000Z'
        ))
        + (SELECT COALESCE(SUM(downloaded_bytes), 0) FROM usage_samples_hour WHERE profile_id = @profileId) AS txBytes
  `);

  return {
    listEligibleProfiles() {
      return eligibleProfilesStatement.all();
    },
    insertMinuteSample(sample) {
      return insertMinuteSampleStatement.run(sample).changes === 1;
    },
    findPreviousCounters(profileId) {
      const counters = previousCountersStatement.get({ profileId });
      return { rxBytes: counters.rxBytes, txBytes: counters.txBytes };
    },
  };
}

module.exports = { createUsageHistoryRepository };
