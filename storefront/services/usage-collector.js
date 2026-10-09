function finiteNonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function counterDelta(current, previous) {
  const delta = finiteNonnegative(current) - finiteNonnegative(previous);
  return delta > 0 ? Math.floor(delta) : 0;
}

function minuteKey(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('now must return a valid date');
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function createUsageCollector({ usageHistory, now = () => new Date() }) {
  return {
    record(snapshot) {
      const snapshotRows = Array.isArray(snapshot) ? snapshot : [];
      const rowsByDeviceId = new Map(snapshotRows
        .filter((row) => row && row.deviceId)
        .map((row) => [row.deviceId, row]));
      const sampledMinute = minuteKey(now());
      let inserted = 0;

      for (const profile of usageHistory.listEligibleProfiles()) {
        const row = rowsByDeviceId.get(profile.device_id);
        if (!row) continue;

        const previous = usageHistory.findPreviousCounters(profile.id);
        const rxBytes = finiteNonnegative(row.rxBytesTotal);
        const txBytes = finiteNonnegative(row.txBytesTotal);
        if (usageHistory.insertMinuteSample({
          profileId: profile.id,
          sampledMinute,
          uploadKbps: finiteNonnegative(row.liveUpKbps),
          downloadKbps: finiteNonnegative(row.liveDownKbps),
          uploadedBytes: counterDelta(rxBytes, previous.rxBytes),
          downloadedBytes: counterDelta(txBytes, previous.txBytes),
          rawRxBytes: rxBytes,
          rawTxBytes: txBytes,
          connected: row.connected === true ? 1 : 0,
        })) inserted += 1;
      }

      return inserted;
    },
  };
}

module.exports = { createUsageCollector };
