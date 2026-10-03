const childProcess = require('child_process');
const defaultFs = require('fs');

function createAdapter({ execFileSync = childProcess.execFileSync, fs = defaultFs, iface = 'awg0' } = {}) {
  function runAwg(args, options = {}) {
    return execFileSync('awg', args, options).toString();
  }

  function dump() {
    let out;
    try {
      out = runAwg(['show', iface, 'dump']).trim();
    } catch (err) {
      return {};
    }
    const lines = out.split('\n');
    const byPubkey = {};
    for (let i = 1; i < lines.length; i += 1) {
      const cols = lines[i].split('\t');
      if (cols.length < 8) continue;
      const [pubkey, , endpoint, allowedIps, latestHandshake, rx, tx] = cols;
      byPubkey[pubkey] = {
        endpoint: endpoint === '(none)' ? null : endpoint,
        allowedIps,
        latestHandshake: parseInt(latestHandshake, 10) || 0,
        rxBytes: parseInt(rx, 10) || 0,
        txBytes: parseInt(tx, 10) || 0,
      };
    }
    return byPubkey;
  }

  function generateKeyPair() {
    const privateKey = runAwg(['genkey']).trim();
    const publicKey = runAwg(['pubkey'], { input: `${privateKey}\n` }).trim();
    return { privateKey, publicKey };
  }

  function addPeer(pubkey, ip) {
    runAwg(['set', iface, 'peer', pubkey, 'allowed-ips', `${ip}/32`]);
  }

  function removePeer(pubkey) {
    runAwg(['set', iface, 'peer', pubkey, 'remove']);
  }

  function readPersistentConfig(confPath) {
    return fs.readFileSync(confPath, 'utf8');
  }

  function writePersistentConfig(confPath, text) {
    const temporary = `${confPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, text, { mode: 0o600 });
      fs.renameSync(temporary, confPath);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  function persistToConf(peers, confPath) {
    const current = readPersistentConfig(confPath);
    const base = current.split('[Peer]')[0].trimEnd();
    const blocks = peers
      .filter((peer) => peer.enabled && !peer.archivedAt)
      .map((peer) => `\n\n[Peer]\n# ${peer.name}\nPublicKey = ${peer.pubkey}\nAllowedIPs = ${peer.ip}/32`)
      .join('');
    writePersistentConfig(confPath, `${base}${blocks}\n`);
  }

  function getServerConfig(confPath) {
    const text = readPersistentConfig(confPath);
    const interfaceConfig = text.split('[Peer]')[0];
    const field = (name) => {
      const match = interfaceConfig.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
      return match ? match[1].trim() : null;
    };
    return {
      pubkey: runAwg(['show', iface, 'public-key']).trim(),
      endpointPort: field('ListenPort'),
      jc: field('Jc'),
      jmin: field('Jmin'),
      jmax: field('Jmax'),
      s1: field('S1'),
      s2: field('S2'),
      h1: field('H1'),
      h2: field('H2'),
      h3: field('H3'),
      h4: field('H4'),
    };
  }

  return {
    dump,
    generateKeyPair,
    addPeer,
    removePeer,
    readPersistentConfig,
    writePersistentConfig,
    persistToConf,
    getServerConfig,
  };
}

const defaultAdapter = createAdapter();

module.exports = { ...defaultAdapter, createAdapter };
