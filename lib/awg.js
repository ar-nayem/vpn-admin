const { execSync } = require('child_process');

const IFACE = 'awg0';

function dump() {
  let out;
  try {
    out = execSync(`awg show ${IFACE} dump`).toString().trim();
  } catch (err) {
    return {};
  }
  const lines = out.split('\n');
  const byPubkey = {};
  for (let i = 1; i < lines.length; i++) {
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

function addPeer(pubkey, ip) {
  execSync(`awg set ${IFACE} peer "${pubkey}" allowed-ips "${ip}/32"`);
}

function removePeer(pubkey) {
  execSync(`awg set ${IFACE} peer "${pubkey}" remove`);
}

function persistToConf(peers, confPath) {
  let base = '';
  try {
    base = require('fs').readFileSync(confPath, 'utf8').split('[Peer]')[0].trimEnd();
  } catch (err) {
    return;
  }
  const blocks = peers
    .filter((p) => p.enabled)
    .map((p) => `\n\n[Peer]\n# ${p.name}\nPublicKey = ${p.pubkey}\nAllowedIPs = ${p.ip}/32`)
    .join('');
  require('fs').writeFileSync(confPath, base + blocks + '\n');
}

function getServerConfig(confPath) {
  const fs = require('fs');
  const text = fs.readFileSync(confPath, 'utf8');
  const iface = text.split('[Peer]')[0];
  const field = (name) => {
    const m = iface.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  const pubkey = execSync(`awg show ${IFACE} public-key`).toString().trim();
  return {
    pubkey,
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

module.exports = { dump, addPeer, removePeer, persistToConf, getServerConfig };
