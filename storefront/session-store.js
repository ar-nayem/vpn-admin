const session = require('express-session');

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.getStatement = db.prepare('SELECT data, expires_at FROM customer_sessions WHERE sid = ?');
    this.setStatement = db.prepare(`INSERT INTO customer_sessions (sid,data,expires_at) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at`);
    this.deleteStatement = db.prepare('DELETE FROM customer_sessions WHERE sid = ?');
    this.touchStatement = db.prepare('UPDATE customer_sessions SET expires_at = ? WHERE sid = ?');
  }
  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid);
      if (!row || row.expires_at <= new Date().toISOString()) return callback(null, null);
      return callback(null, JSON.parse(row.data));
    } catch (error) { return callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie && value.cookie.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 30 * 86400000);
      this.setStatement.run(sid, JSON.stringify(value), expires.toISOString()); callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) { try { this.deleteStatement.run(sid); callback(null); } catch (error) { callback(error); } }
  touch(sid, value, callback = () => {}) {
    try { this.touchStatement.run(new Date(value.cookie.expires).toISOString(), sid); callback(null); } catch (error) { callback(error); }
  }
}

module.exports = { SqliteSessionStore };
