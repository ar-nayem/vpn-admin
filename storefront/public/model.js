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
  return { planSummary, speedLabel, formatBytes, profileView, paymentAvailable, canSubmitOrder, safeError, escapeHtml };
}));
