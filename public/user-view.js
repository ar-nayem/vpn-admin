(function exposeUserView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UserView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const usageRanges = Object.freeze(['1h', '1d', '7d', '10d', '30d', 'lifetime']);

  function groupPeerSnapshots(peers) {
    const groups = new Map();
    for (const peer of peers) {
      if (!groups.has(peer.userNumber)) {
        groups.set(peer.userNumber, {
          userNumber: peer.userNumber,
          userName: peer.userName,
          devices: [],
        });
      }
      groups.get(peer.userNumber).devices.push(peer);
    }
    return [...groups.values()]
      .sort((a, b) => a.userNumber - b.userNumber)
      .map((group) => ({
        ...group,
        devices: group.devices.sort((a, b) => {
          const archived = Number(!!a.archivedAt) - Number(!!b.archivedAt);
          return archived || a.deviceName.localeCompare(b.deviceName);
        }),
      }));
  }

  function buildCreateUserPayload(userName, devices) {
    return {
      userName: String(userName || '').trim(),
      devices: devices.map((device) => String(device || '').trim()).filter(Boolean),
    };
  }

  function buildArchiveUserPayload(userNumber) {
    return { confirmUserNumber: Number(userNumber) };
  }

  function buildArchiveDevicePayload(deviceId) {
    return { confirmDeviceId: deviceId };
  }

  function filterPeersForView(peers, view) {
    if (view === 'deleted') {
      return peers
        .filter((peer) => !!peer.archivedAt)
        .sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());
    }
    return peers.filter((peer) => !peer.archivedAt);
  }

  function transitionWorkspace(state, target) {
    if (target === 'recently-deleted') {
      return { workspace: 'vpn-users', view: state.view === 'deleted' ? 'active' : 'deleted' };
    }
    if (target === 'vpn-users') return { workspace: 'vpn-users', view: 'active' };
    if (['storefront-customers', 'usage-history'].includes(target)) {
      return { workspace: target, view: 'active' };
    }
    throw new TypeError('unknown admin workspace');
  }

  function selectAnalyticsProfiles(profiles) {
    if (!Array.isArray(profiles)) return [];
    return profiles.filter((profile) => profile && typeof profile.id === 'string' && profile.id.trim()
      && typeof profile.codeName === 'string' && profile.codeName.trim()
      && (!Object.hasOwn(profile, 'analyticsEnabled') || profile.analyticsEnabled === true))
      .map((profile) => ({
        id: profile.id,
        codeName: profile.codeName,
        customerName: String(profile.customerName || ''),
        customerEmail: String(profile.customerEmail || ''),
      }));
  }

  function profileCustomerKey(profile) {
    return profile.customerEmail || profile.customerName || 'unknown';
  }

  function reconcileAnalyticsSelection(rawProfiles, selectedCustomerKey, selectedProfileId) {
    const profiles = selectAnalyticsProfiles(rawProfiles);
    const customerKeys = [...new Set(profiles.map(profileCustomerKey))];
    const customerKey = customerKeys.includes(selectedCustomerKey) ? selectedCustomerKey : (customerKeys[0] || '');
    const customerProfiles = profiles.filter((profile) => profileCustomerKey(profile) === customerKey);
    const profileId = customerProfiles.some((profile) => profile.id === selectedProfileId)
      ? selectedProfileId
      : (customerProfiles[0]?.id || '');
    return { profiles, customerKey, profileId };
  }

  async function afterSuccessfulProvisioning(operation, refreshProfiles) {
    const result = await operation();
    await refreshProfiles();
    return result;
  }

  function finiteNonnegative(value) {
    let number;
    try { number = Number(value); } catch { return 0; }
    return Number.isFinite(number) && number > 0 ? Math.min(number, Number.MAX_SAFE_INTEGER) : 0;
  }

  function formatHistorySummary(summary) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) summary = {};
    const uploaded = finiteNonnegative(summary.uploadedBytes);
    const downloaded = finiteNonnegative(summary.downloadedBytes);
    const transferredBytes = Math.min(Number.MAX_SAFE_INTEGER, uploaded + downloaded);
    const minutes = Math.floor(finiteNonnegative(summary.connectedMinutes));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    const bytes = (value) => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let index = 0;
      let amount = value;
      while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
      return `${amount.toFixed(1)} ${units[index]}`;
    };
    const speed = (value) => value >= 1024 ? `${(value / 1024).toFixed(1)} Mbps` : `${Math.round(value)} Kbps`;
    return {
      transferred: bytes(transferredBytes),
      uploadPeak: speed(finiteNonnegative(summary.peakUploadKbps)),
      downloadPeak: speed(finiteNonnegative(summary.peakDownloadKbps)),
      connected: hours ? `${hours} hr${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`,
    };
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
    const chronological = values.length > 1 && timestamps.every(Number.isFinite)
      && timestamps.every((timestamp, index) => index === 0 || timestamp > timestamps[index - 1]);
    const points = values.map((point, index) => {
      const x = values.length === 1 ? chartWidth / 2
        : chronological ? chartWidth * (timestamps[index] - timestamps[0]) / (timestamps.at(-1) - timestamps[0])
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

  return {
    groupPeerSnapshots,
    buildCreateUserPayload,
    buildArchiveUserPayload,
    buildArchiveDevicePayload,
    filterPeersForView,
    transitionWorkspace,
    usageRanges,
    selectAnalyticsProfiles,
    reconcileAnalyticsSelection,
    afterSuccessfulProvisioning,
    formatHistorySummary,
    normalizeUsagePoints,
    createUsagePath,
  };
}));
