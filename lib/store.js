const fs = require('fs');
const path = require('path');
const { writeAtomicJson } = require('./atomic-json');

const FILE = path.join(__dirname, '..', 'data', 'peers.json');

function createStore(file = FILE) {
  function load() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return [];
    }
  }

  function save(peers) {
    writeAtomicJson(file, peers);
  }

  return { load, save };
}

const defaultStore = createStore();

module.exports = { ...defaultStore, createStore };
