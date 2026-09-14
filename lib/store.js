const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'peers.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function save(peers) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(peers, null, 2));
}

module.exports = { load, save };
