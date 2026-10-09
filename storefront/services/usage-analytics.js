const RANGE_MS = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '10d': 10 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};
const RANGE_WIDTH_MS = { '1h': 60 * 1000, '1d': 10 * 60 * 1000, '7d': 60 * 60 * 1000, '10d': 60 * 60 * 1000, '30d': 6 * 60 * 60 * 1000 };
const MAX_LIFETIME_POINTS = 240;

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(number, Number.MAX_SAFE_INTEGER) : 0;
}

function safeAdd(left, right) {
  return Math.min(Number.MAX_SAFE_INTEGER, safeNumber(left) + safeNumber(right));
}

function toPoint(sample, isHourly) {
  return {
    timestamp: sample.timestamp,
    uploadKbps: safeNumber(isHourly ? sample.avgUploadKbps : sample.uploadKbps),
    downloadKbps: safeNumber(isHourly ? sample.avgDownloadKbps : sample.downloadKbps),
    peakUploadKbps: safeNumber(isHourly ? sample.peakUploadKbps : sample.uploadKbps),
    peakDownloadKbps: safeNumber(isHourly ? sample.peakDownloadKbps : sample.downloadKbps),
    uploadedBytes: safeNumber(sample.uploadedBytes),
    downloadedBytes: safeNumber(sample.downloadedBytes),
    connectedMinutes: safeNumber(isHourly ? sample.connectedMinutes : sample.connectedMinutes),
    sampleCount: safeNumber(isHourly ? sample.sampleCount : 1),
    isHourly,
  };
}

function createUsageAnalyticsService({ usageHistory, now = () => new Date(), timezone = 'UTC' }) {
  return {
    getProfileHistory(profileId, range) {
      if (range !== 'lifetime' && !Object.hasOwn(RANGE_MS, range)) {
        throw new RangeError(`Unsupported usage history range: ${range}`);
      }
      const current = now instanceof Date ? new Date(now.getTime()) : new Date(now());
      if (!Number.isFinite(current.getTime())) throw new TypeError('now must return a valid date');
      const end = current.toISOString();
      const start = range === 'lifetime' ? undefined : new Date(current.getTime() - RANGE_MS[range]).toISOString();
      const minuteRows = usageHistory.listMinuteSamples(profileId, start, end).map((row) => toPoint(row, false));
      const hourlyRows = range === '1h' ? [] : usageHistory.listHourlySamples(profileId, start, end).map((row) => toPoint(row, true));
      const rolledHourKeys = new Set(hourlyRows.map(({ timestamp }) => timestamp.slice(0, 13)));
      const rawHourKeys = new Set(minuteRows.map(({ timestamp }) => timestamp.slice(0, 13)));
      let samples = [
        ...(range === 'lifetime' ? hourlyRows : hourlyRows.filter(({ timestamp }) => !rawHourKeys.has(timestamp.slice(0, 13)))),
        ...minuteRows.filter(({ timestamp }) => range !== 'lifetime' || !rolledHourKeys.has(timestamp.slice(0, 13))),
      ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (range === 'lifetime') {
        samples = bucket(samples, 60 * 60 * 1000);
        if (samples.length > MAX_LIFETIME_POINTS) {
          const width = Math.ceil(samples.length / MAX_LIFETIME_POINTS);
          samples = bucket(samples, width * 60 * 60 * 1000);
        }
      } else if (range !== 'lifetime' && range !== '1h') {
        samples = bucket(samples, RANGE_WIDTH_MS[range]);
      }
      const summary = samples.reduce((total, sample) => ({
        uploadedBytes: safeAdd(total.uploadedBytes, sample.uploadedBytes),
        downloadedBytes: safeAdd(total.downloadedBytes, sample.downloadedBytes),
        peakUploadKbps: Math.max(total.peakUploadKbps, safeNumber(sample.peakUploadKbps)),
        peakDownloadKbps: Math.max(total.peakDownloadKbps, safeNumber(sample.peakDownloadKbps)),
        connectedMinutes: safeAdd(total.connectedMinutes, sample.connectedMinutes),
      }), { uploadedBytes: 0, downloadedBytes: 0, peakUploadKbps: 0, peakDownloadKbps: 0, connectedMinutes: 0 });
      return {
        range,
        timezone,
        points: samples.map(({ timestamp, uploadKbps, downloadKbps }) => ({ timestamp, uploadKbps, downloadKbps })),
        summary,
      };
    },
  };
}

function bucket(samples, widthMs) {
  const groups = new Map();
  for (const sample of samples) {
    const start = Math.floor(Date.parse(sample.timestamp) / widthMs) * widthMs;
    let group = groups.get(start);
    if (!group) {
      group = { timestamp: new Date(start).toISOString(), uploadWeighted: 0, downloadWeighted: 0, weight: 0,
        peakUploadKbps: 0, peakDownloadKbps: 0, uploadedBytes: 0, downloadedBytes: 0, connectedMinutes: 0 };
      groups.set(start, group);
    }
    const weight = safeNumber(sample.sampleCount) || 1;
    group.uploadWeighted = safeAdd(group.uploadWeighted, safeNumber(sample.uploadKbps) * weight);
    group.downloadWeighted = safeAdd(group.downloadWeighted, safeNumber(sample.downloadKbps) * weight);
    group.weight = safeAdd(group.weight, weight);
    group.peakUploadKbps = Math.max(group.peakUploadKbps, safeNumber(sample.peakUploadKbps));
    group.peakDownloadKbps = Math.max(group.peakDownloadKbps, safeNumber(sample.peakDownloadKbps));
    group.uploadedBytes = safeAdd(group.uploadedBytes, sample.uploadedBytes);
    group.downloadedBytes = safeAdd(group.downloadedBytes, sample.downloadedBytes);
    group.connectedMinutes = safeAdd(group.connectedMinutes, sample.connectedMinutes);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    uploadKbps: safeNumber(group.uploadWeighted / group.weight),
    downloadKbps: safeNumber(group.downloadWeighted / group.weight),
    sampleCount: group.weight,
  })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

module.exports = { createUsageAnalyticsService };
