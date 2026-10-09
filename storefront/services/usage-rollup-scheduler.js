const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, '..', 'workers', 'usage-rollup-worker.js');

function startWorker(databasePath, completedHour) {
  return new Worker(WORKER_PATH, {
    workerData: { databasePath, completedHour },
  });
}

function createUsageRollupScheduler({ databasePath, runWorker = startWorker, onSuccess = () => {}, logger = console }) {
  let active = null;

  function fail(state) {
    if (active !== state || state.settled) return;
    state.settled = true;
    active = null;
    if (!state.failureLogged) {
      state.failureLogged = true;
      logger.error('Usage analytics rollup failed');
    }
  }

  return {
    dispatch(completedHour) {
      if (active) return false;

      let worker;
      try {
        worker = runWorker(databasePath, completedHour);
      } catch (error) {
        logger.error('Usage analytics rollup failed');
        return false;
      }

      const state = { worker, succeeded: false, failed: false, failureLogged: false, settled: false };
      active = state;
      worker.on('message', (message) => {
        if (message && message.ok === true) state.succeeded = true;
        else if (message && message.ok === false) state.failed = true;
      });
      worker.on('error', () => {
        state.failed = true;
        if (!state.failureLogged) {
          state.failureLogged = true;
          logger.error('Usage analytics rollup failed');
        }
      });
      worker.on('exit', (code) => {
        if (active !== state || state.settled) return;
        if (code !== 0 || !state.succeeded || state.failed) {
          fail(state);
          return;
        }
        state.settled = true;
        active = null;
        try { onSuccess(completedHour); }
        catch (error) { logger.error('Usage analytics rollup failed'); }
      });
      return true;
    },
  };
}

module.exports = { createUsageRollupScheduler };
