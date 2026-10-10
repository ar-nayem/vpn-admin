const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { createUsageHistoryRepository } = require('../repositories/usage-history');
const { createUsageCollector } = require('../services/usage-collector');

let db;
let success = false;
try {
  // The admin process initializes/migrates this database before dispatching.
  // Do not perform schema or journal-mode writes in the collection worker.
  db = new Database(workerData.databasePath, { fileMustExist: true, timeout: 50 });
  db.pragma('foreign_keys = ON');
  const collector = createUsageCollector({
    usageHistory: createUsageHistoryRepository(db),
    now: () => new Date(workerData.sampledMinute),
  });
  db.transaction(() => collector.record(workerData.snapshot)).immediate();
  success = true;
} catch {
  process.exitCode = 1;
} finally {
  if (db) {
    try { db.close(); }
    catch {
      success = false;
      process.exitCode = 1;
    }
  }
  parentPort.postMessage({ ok: success });
  parentPort.close();
}
