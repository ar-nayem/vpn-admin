const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, '..', 'workers', 'usage-collection-worker.js');

function startWorker(databasePath, sampledMinute, snapshot) {
  return new Worker(WORKER_PATH, { workerData: { databasePath, sampledMinute, snapshot } });
}

function createUsageCollectionScheduler({ databasePath, now = () => new Date(), runWorker = startWorker, onSuccess = () => {}, logger = console }) {
  let active = null;
  let lastAttemptMinute = null;

  return {
    record(snapshot) {
      if (active || !Array.isArray(snapshot) || !snapshot.length) return false;
      const date = new Date(now());
      date.setUTCSeconds(0, 0);
      const sampledMinute = date.toISOString();
      if (sampledMinute === lastAttemptMinute) return false;
      // Bound worker creation, including failures, to one attempt per UTC minute.
      // A failed minute is skipped; a later sample resumes from persisted counters.
      lastAttemptMinute = sampledMinute;
      let worker;
      try {
        const measurements = snapshot.filter((row) => row && row.deviceId).map((row) => ({
          deviceId: row.deviceId,
          rxBytesTotal: row.rxBytesTotal, txBytesTotal: row.txBytesTotal,
          liveUpKbps: row.liveUpKbps, liveDownKbps: row.liveDownKbps,
          connected: row.connected,
        }));
        worker = runWorker(databasePath, sampledMinute, measurements);
      } catch {
        logger.error('Usage analytics collection failed');
        return false;
      }

      const state = { succeeded: false, failed: false };
      active = state;
      worker.on('message', (message) => {
        if (message && message.ok === true) state.succeeded = true;
        else if (message && message.ok === false) state.failed = true;
      });
      worker.on('error', () => { state.failed = true; });
      worker.on('exit', (code) => {
        if (active !== state) return;
        active = null;
        if (code !== 0 || !state.succeeded || state.failed) {
          logger.error('Usage analytics collection failed');
          return;
        }
        try { onSuccess(sampledMinute); }
        catch { logger.error('Usage analytics collection failed'); }
      });
      return true;
    },
  };
}

module.exports = { createUsageCollectionScheduler };
