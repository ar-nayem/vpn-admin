const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('./schema');

function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

module.exports = { openDatabase };
