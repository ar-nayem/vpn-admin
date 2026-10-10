(function expose(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.StorefrontModel = model;
}(typeof window === 'undefined' ? globalThis : window, function factory() {
  function planSummary(plan, months) {
    const count = Number(months);
    if (!plan || !Number.isInteger(count) || count < 1) throw new TypeError('Choose a valid term');
    return { priceCny: plan.priceCny * count, quotaGb: plan.quotaGb * count, months: count, speed: speedLabel(plan.downKbps, plan.upKbps) };
  }
  function speedLabel(downKbps, upKbps) {
    if (!downKbps && !upKbps) return 'Unlimited speed';
    return `${Math.max(downKbps, upKbps) / 1024} Mbps up & down`;
  }
  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(value >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
    return `${(value / 1024 ** 2).toFixed(0)} MB`;
  }
  function profileView(profile) {
    const quota = Math.max(0, Number(profile.quotaBytes) || 0);
    const remaining = Math.max(0, Number(profile.remainingBytes) || 0);
    return {
      ...profile, remainingLabel: formatBytes(remaining), totalLabel: formatBytes(quota),
      usedLabel: formatBytes(Math.max(0, Number(profile.usedBytes) || 0)),
      percentRemaining: quota ? Math.max(0, Math.min(100, Math.round(remaining / quota * 100))) : 0,
      exhausted: quota > 0 && remaining === 0,
      expiryLabel: profile.expiresAt ? new Date(profile.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'No time expiry',
      speedLabel: speedLabel(profile.downKbps, profile.upKbps),
      action: profile.planId === 'trial' ? 'Upgrade' : 'Renew',
    };
  }
  function paymentAvailable(qr) { return Boolean(qr && qr.available); }
  function canSubmitOrder({ proof, paymentMethod, qrAvailability }) { return Boolean(proof && paymentMethod && qrAvailability[paymentMethod]); }
  function safeError(error) {
    const code = error && error.code;
    const known = { RATE_LIMITED: 'Too many attempts. Please wait and try again.', PROOF_REQUIRED: 'Add your payment screenshot to continue.', QR_UNAVAILABLE: 'That payment method is temporarily unavailable.', VERIFICATION_REQUIRED: 'Verify your email to continue.', ACCOUNT_NOT_FOUND: 'No account exists for this email. Choose Create account or Start free.' };
    return known[code] || (error && error.message) || 'Something went wrong. Please try again.';
  }
  function escapeHtml(value) { return String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
  const usageRanges = ['1h', '1d', '7d', '10d', '30d', 'lifetime'];
  function isUsageRange(range) { return typeof range === 'string' && usageRanges.includes(range); }
  function finiteNonnegative(value) {
    let number;
    try { number = Number(value); } catch { return 0; }
    return Number.isFinite(number) && number > 0 ? Math.min(number, Number.MAX_SAFE_INTEGER) : 0;
  }
  function rangeTimeLabels(range) {
    return ({
      '1h': ['60 min ago', '30 min ago', 'Now'],
      '1d': ['24 hr ago', '12 hr ago', 'Now'],
      '7d': ['7 days ago', '3.5 days ago', 'Now'],
      '10d': ['10 days ago', '5 days ago', 'Now'],
      '30d': ['30 days ago', '15 days ago', 'Now'],
      lifetime: ['Start', 'Midpoint', 'Now'],
    })[range];
  }
  function formatUsageChartContext(history, range, timezone = 'UTC') {
    const selectedRange = isUsageRange(range) ? range : '1d';
    const points = Array.isArray(history) ? history : [];
    const maxKbps = points.reduce((maximum, point) => Math.max(maximum,
      finiteNonnegative(point && point.uploadKbps), finiteNonnegative(point && point.downloadKbps)), 0);
    const timestamps = points.map((point) => {
      try { return Date.parse(point && point.timestamp); } catch { return NaN; }
    });
    const chronological = timestamps.length > 1 && timestamps.every(Number.isFinite)
      && timestamps.every((timestamp, index) => index === 0 || timestamp > timestamps[index - 1]);
    let timeLabels = rangeTimeLabels(selectedRange);
    if (chronological) {
      const first = timestamps[0];
      const midpoint = first + (timestamps.at(-1) - first) / 2;
      const values = [first, midpoint, timestamps.at(-1)];
      const options = selectedRange === '1h' || selectedRange === '1d'
        ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }
        : { month: 'short', day: 'numeric', ...(selectedRange === 'lifetime' ? { year: 'numeric' } : {}), timeZone: timezone };
      try {
        timeLabels = values.map((timestamp) => new Intl.DateTimeFormat('en-GB', options).format(timestamp));
      } catch {
        const utcOptions = { ...options, timeZone: 'UTC' };
        timeLabels = values.map((timestamp) => new Intl.DateTimeFormat('en-GB', utcOptions).format(timestamp));
      }
    }
    const maxSpeed = maxKbps >= 1024 ? `${(maxKbps / 1024).toFixed(1)} Mbps`
      : maxKbps > 0 && maxKbps < 1 ? '<1 Kbps' : `${Math.round(maxKbps)} Kbps`;
    return { timeLabels, scaleLabel: `Max ${maxSpeed} · Baseline 0 Kbps` };
  }
  function normalizeUsagePoints(history, width = 600, height = 180) {
    if (!Array.isArray(history) || !history.length) return { points: [], maxKbps: 0 };
    const chartWidth = Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : 600;
    const chartHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : 180;
    const values = history.map((point) => ({
      uploadKbps: finiteNonnegative(point && point.uploadKbps),
      downloadKbps: finiteNonnegative(point && point.downloadKbps),
    }));
    const maxKbps = values.reduce((max, point) => Math.max(max, point.uploadKbps, point.downloadKbps), 0);
    const timestamps = history.map((point) => Date.parse(point && point.timestamp));
    const hasChronologicalTimeline = values.length > 1
      && timestamps.every(Number.isFinite)
      && timestamps.every((timestamp, index) => index === 0 || timestamp > timestamps[index - 1]);
    const firstTimestamp = timestamps[0];
    const lastTimestamp = timestamps[timestamps.length - 1];
    const points = values.map((point, index) => {
      const x = values.length === 1
        ? chartWidth / 2
        : hasChronologicalTimeline
          ? chartWidth * (timestamps[index] - firstTimestamp) / (lastTimestamp - firstTimestamp)
          : chartWidth * index / (values.length - 1);
      return {
        x,
        uploadY: maxKbps ? chartHeight - point.uploadKbps / maxKbps * chartHeight : chartHeight,
        downloadY: maxKbps ? chartHeight - point.downloadKbps / maxKbps * chartHeight : chartHeight,
      };
    });
    return { points, maxKbps };
  }
  function createUsagePath(points, series) {
    if (!Array.isArray(points) || !['uploadY', 'downloadY'].includes(series)) return '';
    const coordinates = points.map((point) => [Number(point && point.x), Number(point && point[series])]);
    if (!coordinates.length || coordinates.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return '';
    return coordinates.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  }
  function formatUsageSummary(summary = {}) {
    if (!summary || typeof summary !== 'object') summary = {};
    const uploaded = finiteNonnegative(summary.uploadedBytes);
    const downloaded = finiteNonnegative(summary.downloadedBytes);
    const total = Math.min(Number.MAX_SAFE_INTEGER, uploaded + downloaded);
    const minutes = Math.floor(finiteNonnegative(summary.connectedMinutes));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const speed = (value) => value >= 1024 ? `${(value / 1024).toFixed(1)} Mbps` : `${Math.round(value)} Kbps`;
    return {
      transferred: formatBytes(total),
      uploadPeak: speed(finiteNonnegative(summary.peakUploadKbps)),
      downloadPeak: speed(finiteNonnegative(summary.peakDownloadKbps)),
      connected: hours ? `${hours} hr${remainingMinutes ? ` ${remainingMinutes} min` : ''}` : `${remainingMinutes} min`,
    };
  }
  return { planSummary, speedLabel, formatBytes, profileView, paymentAvailable, canSubmitOrder, safeError, escapeHtml,
    usageRanges, isUsageRange, normalizeUsagePoints, createUsagePath, formatUsageSummary,
    formatUsageChartContext };
}));
