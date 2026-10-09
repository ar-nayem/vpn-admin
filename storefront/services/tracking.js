const { normalizeEmail } = require('./auth');
const VALID_ANALYTICS_RANGES = new Set(['1h', '1d', '7d', '10d', '30d', 'lifetime']);

class TrackingError extends Error {
  constructor(message, code) { super(message); this.name = 'TrackingError'; this.code = code; }
}

function createTrackingService({ profiles, verification, provisioning, usageAnalytics }) {
  async function dashboard(rows, signedIn = false) {
    try {
      const output = await Promise.all(rows.map(async (profile) => {
        const live = profile.device_id ? await provisioning.getStatus(profile.device_id) : { usedBytes: 0, status: profile.state };
        const usedBytes = Math.max(0, Number(live.usedBytes) || 0);
        const quotaBytes = Number(profile.quota_bytes) || 0;
        const result = {
          id: profile.id,
          codeName: profile.code_name,
          planId: profile.plan_id,
          planName: profile.plan_name,
          quotaBytes,
          usedBytes,
          remainingBytes: Math.max(0, quotaBytes - usedBytes),
          expiresAt: profile.expires_at,
          downKbps: profile.down_kbps,
          upKbps: profile.up_kbps,
          status: live.status || (live.enabled === false ? 'disabled' : profile.state),
        };
        if (signedIn) result.analyticsEnabled = profile.analytics_enabled === 1;
        return result;
      }));
      return { profiles: output };
    } catch {
      throw new TrackingError('VPN status is temporarily unavailable', 'STATUS_TEMPORARILY_UNAVAILABLE');
    }
  }

  return {
    async getGuestDashboard({ email, verificationGrant }) {
      const normalizedEmail = normalizeEmail(email);
      if (!verificationGrant || !verification.consumeGrant({ email: normalizedEmail, purpose: 'tracking', grant: verificationGrant })) {
        throw new TrackingError('email verification is required', 'VERIFICATION_REQUIRED');
      }
      return dashboard(profiles.findByNormalizedEmail(normalizedEmail));
    },
    getCustomerDashboard(customerId) {
      if (!customerId) throw new TrackingError('customer session is required', 'AUTH_REQUIRED');
      return dashboard(profiles.findByCustomer(customerId), true);
    },
    async getCustomerHistory({ customerId, profileId, range = '1d' }) {
      if (!VALID_ANALYTICS_RANGES.has(range)) {
        throw Object.assign(new TypeError('unsupported usage history range'), { status: 400, code: 'INVALID_RANGE' });
      }
      const profile = profiles.findById(profileId);
      if (!profile || profile.customer_id !== customerId || profile.analytics_enabled !== 1 || !profile.device_id || profile.state !== 'active') {
        throw Object.assign(new TrackingError('profile not found', 'NOT_FOUND'), { status: 404 });
      }
      try {
        return await usageAnalytics.getProfileHistory(profileId, range);
      } catch {
        throw Object.assign(new TrackingError('usage history is temporarily unavailable', 'ANALYTICS_UNAVAILABLE'), { status: 503 });
      }
    },
  };
}

module.exports = { createTrackingService, TrackingError };
