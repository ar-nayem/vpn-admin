const VALID_ANALYTICS_RANGES = new Set(['1h', '1d', '7d', '10d', '30d', 'lifetime']);

function createStorefrontAdminService({ db, orders, qr, proofStoragePath, usageAnalytics }) {
  function analyticsUnavailable() {
    return Object.assign(new Error('usage history is temporarily unavailable'), { status: 503, code: 'ANALYTICS_UNAVAILABLE' });
  }

  const listStatement = db.prepare(`
    SELECT o.*, c.name AS customer_name, c.normalized_email AS customer_email,
      p.code_name, p.device_id
    FROM orders o JOIN customers c ON c.id=o.customer_id JOIN vpn_profiles p ON p.id=o.profile_id
    ORDER BY CASE o.state WHEN 'pending' THEN 0 WHEN 'provisioning_failed' THEN 1 ELSE 2 END, o.created_at DESC
  `);
  const listAnalyticsProfilesStatement = db.prepare(`
    SELECT p.id, p.code_name AS codeName, c.name AS customerName,
      CASE WHEN c.id = 'internal-legacy-vpn-clients' THEN NULL ELSE c.normalized_email END AS customerEmail
    FROM vpn_profiles p JOIN customers c ON c.id = p.customer_id
    WHERE p.analytics_enabled = 1 AND p.device_id IS NOT NULL AND p.state = 'active'
    ORDER BY p.created_at, p.code_name
  `);
  const eligibleProfileStatement = db.prepare(`
    SELECT p.code_name AS codeName, c.name AS customerName,
      CASE WHEN c.id = 'internal-legacy-vpn-clients' THEN NULL ELSE c.normalized_email END AS customerEmail
    FROM vpn_profiles p JOIN customers c ON c.id = p.customer_id
    WHERE p.id = ? AND p.analytics_enabled = 1 AND p.device_id IS NOT NULL AND p.state = 'active'
  `);
  return {
    listOrders() { return listStatement.all(); },
    listAnalyticsProfiles() { return listAnalyticsProfilesStatement.all(); },
    async getProfileHistory({ profileId, range = '1d' }) {
      if (!VALID_ANALYTICS_RANGES.has(range)) {
        throw Object.assign(new TypeError('unsupported usage history range'), { status: 400, code: 'INVALID_RANGE' });
      }
      let profile;
      try {
        profile = eligibleProfileStatement.get(profileId);
      } catch {
        throw analyticsUnavailable();
      }
      if (!profile) throw Object.assign(new Error('profile not found'), { status: 404, code: 'NOT_FOUND' });
      try {
        return {
          ...await usageAnalytics.getProfileHistory(profileId, range),
          customerName: profile.customerName,
          customerEmail: profile.customerEmail,
          codeName: profile.codeName,
        };
      } catch {
        throw analyticsUnavailable();
      }
    },
    approveOrder(input) { return orders.approveOrder(input); },
    retryProvisioning(input) { return orders.retryProvisioning(input); },
    rejectOrder(input) { return orders.rejectOrder(input); },
    proofPath(orderId) {
      const row = db.prepare('SELECT proof_filename FROM orders WHERE id = ?').get(orderId);
      if (!row || !row.proof_filename || require('path').basename(row.proof_filename) !== row.proof_filename) return null;
      return { root: proofStoragePath, filename: row.proof_filename };
    },
    storeQrImage(method, file, adminRef) { return qr.storeQrImage(method, file, adminRef); },
    qrStatus() { return { wechat: qr.getActiveQr('wechat'), alipay: qr.getActiveQr('alipay') }; },
  };
}

module.exports = { createStorefrontAdminService };
