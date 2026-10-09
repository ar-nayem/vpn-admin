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
  };
}

module.exports = { createUsageHistoryRepository };
