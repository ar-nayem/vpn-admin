const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../db/database');
const { createUsageHistoryRepository } = require('../repositories/usage-history');

let db;
let success = false;
try {
  db = openDatabase(workerData.databasePath);
  const usageHistory = createUsageHistoryRepository(db);
  usageHistory.rollupCompletedHours(new Date(workerData.completedHour));
  success = true;
} catch (error) {
  process.exitCode = 1;
} finally {
  if (db) {
    try { db.close(); }
    catch (error) {
      success = false;
      process.exitCode = 1;
    }
  }
  parentPort.postMessage({ ok: success });
  parentPort.close();
}
