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

  function finiteNonnegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(number, Number.MAX_SAFE_INTEGER) : 0;
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
    usageRanges,
    selectAnalyticsProfiles,
    normalizeUsagePoints,
    createUsagePath,
  };
}));
