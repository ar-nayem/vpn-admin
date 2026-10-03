const { randomUUID: defaultRandomUUID } = require('crypto');
const {
  allocateIp,
  nextUserNumber,
  projectPeer,
  projectPeers,
  groupUsers,
} = require('./user-model');

class ProvisioningError extends Error {
  constructor(message, { code = 'INVALID_REQUEST', status = 400, cause } = {}) {
    super(message, { cause });
    this.name = 'ProvisioningError';
    this.code = code;
    this.status = status;
  }
}

function cleanName(value, label) {
  const name = String(value || '').trim();
  if (!name) throw new ProvisioningError(`${label} is required`);
  if (name.length > 80) throw new ProvisioningError(`${label} must be 80 characters or fewer`);
  return name;
}

function validateDeviceNames(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10) {
    throw new ProvisioningError('between 1 and 10 devices are required');
  }
  const names = values.map((value) => cleanName(value, 'device name'));
  const unique = new Set(names.map((name) => name.toLocaleLowerCase()));
  if (unique.size !== names.length) {
    throw new ProvisioningError('device names must be unique', { code: 'DUPLICATE_DEVICE', status: 409 });
  }
  return names;
}

function publicDevice(peer) {
  const { privateKey, ...safe } = peer;
  return safe;
}

function createProvisioningService({
  peerStore,
  keyStore,
  awg,
  now = () => new Date(),
  randomUUID = defaultRandomUUID,
  clientPrefix = '10.66.67',
  confPath = '/etc/amnezia/amneziawg/awg0.conf',
}) {
  function transact({ oldPeers, oldKeys, nextPeers, nextKeys, additions = [], removals = [] }) {
    const oldConfig = awg.readPersistentConfig(confPath);
    const added = [];
    const removed = [];
    try {
      for (const peer of additions) {
        awg.addPeer(peer.pubkey, peer.ip);
        added.push(peer);
      }
      for (const peer of removals) {
        awg.removePeer(peer.pubkey);
        removed.push(peer);
      }
      awg.persistToConf(nextPeers, confPath);
      peerStore.save(nextPeers);
      keyStore.replace(nextKeys);
    } catch (cause) {
      const rollbackErrors = [];
      for (const peer of [...added].reverse()) {
        try { awg.removePeer(peer.pubkey); } catch (err) { rollbackErrors.push(err); }
      }
      for (const peer of removed) {
        try { awg.addPeer(peer.pubkey, peer.ip); } catch (err) { rollbackErrors.push(err); }
      }
      try { awg.writePersistentConfig(confPath, oldConfig); } catch (err) { rollbackErrors.push(err); }
      try { peerStore.save(oldPeers); } catch (err) { rollbackErrors.push(err); }
      try { keyStore.replace(oldKeys); } catch (err) { rollbackErrors.push(err); }
      if (rollbackErrors.length) {
        throw new ProvisioningError('operation failed and rollback requires administrator attention', {
          code: 'ROLLBACK_FAILED',
          status: 500,
          cause,
        });
      }
      throw cause;
    }
  }

  function buildDevice({ peers, userNumber, userName, deviceName }) {
    let ip;
    try {
      ip = allocateIp(peers, clientPrefix);
    } catch (cause) {
      throw new ProvisioningError(cause.message, { code: 'IP_SPACE_EXHAUSTED', status: 409, cause });
    }
    const { privateKey, publicKey } = awg.generateKeyPair();
    const createdAt = now().toISOString();
    const peer = {
      name: `${userName} — ${deviceName}`,
      pubkey: publicKey,
      ip,
      enabled: true,
      downKbps: 0,
      upKbps: 0,
      userNumber,
      userName,
      deviceId: randomUUID(),
      deviceName,
      createdAt,
    };
    return { peer, privateKey };
  }

  function createUser(input = {}) {
    const userName = cleanName(input.userName, 'user name');
    const deviceNames = validateDeviceNames(input.devices);
    const oldPeers = peerStore.load();
    const oldKeys = keyStore.load();
    const userNumber = nextUserNumber(oldPeers);
    const nextPeers = [...oldPeers];
    const nextKeys = { ...oldKeys };
    const additions = [];

    for (const deviceName of deviceNames) {
      const { peer, privateKey } = buildDevice({
        peers: nextPeers,
        userNumber,
        userName,
        deviceName,
      });
      nextPeers.push(peer);
      nextKeys[peer.pubkey] = privateKey;
      additions.push(peer);
    }

    transact({ oldPeers, oldKeys, nextPeers, nextKeys, additions });
    return { userNumber, userName, devices: additions.map(publicDevice) };
  }

  function addDevice(userNumberValue, input = {}) {
    const userNumber = Number(userNumberValue);
    const deviceName = cleanName(input.deviceName, 'device name');
    const oldPeers = peerStore.load();
    const projected = projectPeers(oldPeers);
    const userDevices = projected.filter((peer) => peer.userNumber === userNumber);
    if (!userDevices.length) {
      throw new ProvisioningError('user not found', { code: 'NOT_FOUND', status: 404 });
    }
    if (userDevices.every((peer) => peer.archivedAt)) {
      throw new ProvisioningError('archived user cannot receive devices', { code: 'ARCHIVED', status: 409 });
    }
    if (userDevices.some((peer) => !peer.archivedAt && peer.deviceName.toLocaleLowerCase() === deviceName.toLocaleLowerCase())) {
      throw new ProvisioningError('device name already exists for this user', { code: 'DUPLICATE_DEVICE', status: 409 });
    }
    const oldKeys = keyStore.load();
    const { peer, privateKey } = buildDevice({
      peers: oldPeers,
      userNumber,
      userName: userDevices[0].userName,
      deviceName,
    });
    const nextPeers = [...oldPeers, peer];
    const nextKeys = { ...oldKeys, [peer.pubkey]: privateKey };
    transact({ oldPeers, oldKeys, nextPeers, nextKeys, additions: [peer] });
    return publicDevice(peer);
  }

  function archiveMatching(predicate, notFoundMessage) {
    const oldPeers = peerStore.load();
    const oldKeys = keyStore.load();
    const timestamp = now().toISOString();
    const removals = [];
    let matched = 0;
    const nextPeers = oldPeers.map((peer, index) => {
      const projected = projectPeer(peer, index);
      if (!predicate(projected)) return peer;
      matched += 1;
      if (peer.enabled && !projected.archivedAt) removals.push(peer);
      return {
        ...peer,
        userNumber: projected.userNumber,
        userName: projected.userName,
        deviceId: projected.deviceId,
        deviceName: projected.deviceName,
        enabled: false,
        archivedAt: projected.archivedAt || timestamp,
      };
    });
    if (!matched) {
      throw new ProvisioningError(notFoundMessage, { code: 'NOT_FOUND', status: 404 });
    }
    const nextKeys = { ...oldKeys };
    for (const peer of removals) delete nextKeys[peer.pubkey];
    transact({ oldPeers, oldKeys, nextPeers, nextKeys, removals });
    return { nextPeers, removals };
  }

  function archiveUser(userNumberValue) {
    const userNumber = Number(userNumberValue);
    const result = archiveMatching((peer) => peer.userNumber === userNumber, 'user not found');
    return groupUsers(result.nextPeers).find((user) => user.userNumber === userNumber);
  }

  function listUsers() {
    return groupUsers(peerStore.load());
  }

  function archiveDevice(deviceId) {
    const result = archiveMatching((peer) => peer.deviceId === deviceId, 'device not found');
    return publicDevice(projectPeers(result.nextPeers).find((peer) => peer.deviceId === deviceId));
  }

  return { createUser, addDevice, archiveDevice, archiveUser, listUsers };
}

module.exports = { createProvisioningService, ProvisioningError };
