(function exposeUserView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UserView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
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

  return {
    groupPeerSnapshots,
    buildCreateUserPayload,
    buildArchiveUserPayload,
    buildArchiveDevicePayload,
  };
}));
