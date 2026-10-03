function projectPeer(peer, index) {
  const userNumber = Number.isInteger(peer.userNumber) && peer.userNumber > 0
    ? peer.userNumber
    : index + 1;

  return {
    ...peer,
    userNumber,
    userName: peer.userName || peer.name || `User ${userNumber}`,
    deviceId: peer.deviceId || `legacy-${index + 1}`,
    deviceName: peer.deviceName || 'Existing device',
    archivedAt: peer.archivedAt || null,
  };
}

function projectPeers(peers) {
  return peers.map(projectPeer);
}

function nextUserNumber(peers) {
  return projectPeers(peers).reduce(
    (highest, peer) => Math.max(highest, peer.userNumber),
    0
  ) + 1;
}

function groupUsers(peers) {
  const users = new Map();
  for (const peer of projectPeers(peers)) {
    if (!users.has(peer.userNumber)) {
      users.set(peer.userNumber, {
        userNumber: peer.userNumber,
        userName: peer.userName,
        devices: [],
      });
    }
    users.get(peer.userNumber).devices.push(peer);
  }

  return [...users.values()]
    .sort((a, b) => a.userNumber - b.userNumber)
    .map((user) => ({
      ...user,
      devices: user.devices.sort((a, b) => {
        const archiveOrder = Number(!!a.archivedAt) - Number(!!b.archivedAt);
        return archiveOrder || a.deviceName.localeCompare(b.deviceName);
      }),
    }));
}

function allocateIp(peers, prefix) {
  if (!/^\d{1,3}(?:\.\d{1,3}){2}$/.test(prefix)) {
    throw new Error('invalid client IP prefix');
  }
  const used = new Set(peers.map((peer) => peer.ip));
  for (let host = 2; host <= 254; host += 1) {
    const candidate = `${prefix}.${host}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('no client IP addresses available');
}

module.exports = {
  projectPeer,
  projectPeers,
  nextUserNumber,
  groupUsers,
  allocateIp,
};
