const { normalizeEmail } = require('./auth');

class TrackingError extends Error {
  constructor(message, code) { super(message); this.name = 'TrackingError'; this.code = code; }
}

function createTrackingService({ profiles, verification, provisioning }) {
  async function dashboard(rows) {
    try {
      const output = await Promise.all(rows.map(async (profile) => {
        const live = await provisioning.getStatus(profile.device_id);
        const usedBytes = Math.max(0, Number(live.usedBytes) || 0);
        const quotaBytes = Number(profile.quota_bytes) || 0;
        return {
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
      return dashboard(profiles.findByCustomer(customerId));
    },
  };
}

module.exports = { createTrackingService, TrackingError };
