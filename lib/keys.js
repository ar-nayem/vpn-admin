const fs = require('fs');
const path = require('path');
const { writeAtomicJson } = require('./atomic-json');

const FILE = path.join(__dirname, '..', 'data', 'private-keys.json');

function createKeyStore(file = FILE) {
  function load() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return {};
    }
  }

  function replace(allKeys) {
    writeAtomicJson(file, allKeys, 0o600);
  }

  function getPrivateKey(pubkey) {
    return load()[pubkey] || null;
  }

  function setPrivateKey(pubkey, privateKey) {
    const allKeys = load();
    allKeys[pubkey] = privateKey;
    replace(allKeys);
  }

  function deletePrivateKey(pubkey) {
    const allKeys = load();
    delete allKeys[pubkey];
    replace(allKeys);
  }

  return { load, replace, getPrivateKey, setPrivateKey, deletePrivateKey };
}

const defaultStore = createKeyStore();

module.exports = { ...defaultStore, createKeyStore };
