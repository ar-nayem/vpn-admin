const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'private-keys.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    return {};
  }
}

function save(keys) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

function getPrivateKey(pubkey) {
  return load()[pubkey] || null;
}

function setPrivateKey(pubkey, privateKey) {
  const keys = load();
  keys[pubkey] = privateKey;
  save(keys);
}

module.exports = { getPrivateKey, setPrivateKey };
