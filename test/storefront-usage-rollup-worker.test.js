const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

let createUsageRollupScheduler;
try {
  ({ createUsageRollupScheduler } = require('../storefront/services/usage-rollup-scheduler'));
} catch (error) {
  createUsageRollupScheduler = undefined;
}

test('scheduler dispatches work through the worker runner and skips duplicate cadence', async () => {
  assert.equal(typeof createUsageRollupScheduler, 'function');
  const worker = new EventEmitter();
  const dispatched = [];
  let workerJobCompleted = false;
  const scheduler = createUsageRollupScheduler({
    databasePath: '/private/storefront.sqlite',
    runWorker(databasePath) {
      dispatched.push(databasePath);
      setImmediate(() => {
        workerJobCompleted = true;
        worker.emit('message', { ok: true });
        worker.emit('exit', 0);
      });
      return worker;
    },
    logger: { error() {} },
  });

  assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), true);
  assert.equal(workerJobCompleted, false);
  assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), false);
  assert.deepEqual(dispatched, ['/private/storefront.sqlite']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workerJobCompleted, true);
});

test('successful worker exit clears the active state and reports the completed hour', () => {
  assert.equal(typeof createUsageRollupScheduler, 'function');
  const worker = new EventEmitter();
  const completed = [];
  const scheduler = createUsageRollupScheduler({
    databasePath: '/private/storefront.sqlite',
    runWorker: () => worker,
    onSuccess: (hour) => completed.push(hour),
    logger: { error() {} },
  });

  assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), true);
  worker.emit('message', { ok: true });
  worker.emit('exit', 0);
  assert.deepEqual(completed, ['2026-10-09T12:00:00.000Z']);
  assert.equal(scheduler.dispatch('2026-10-09T13:00:00.000Z'), true);
});

test('worker errors and nonzero exits log generically, clear active state, and allow retry', () => {
  assert.equal(typeof createUsageRollupScheduler, 'function');
  const workers = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
  const logged = [];
  let index = 0;
  const scheduler = createUsageRollupScheduler({
    databasePath: '/private/storefront.sqlite',
    runWorker: () => workers[index++],
    logger: { error: (message) => logged.push(message) },
  });

  assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), true);
  workers[0].emit('error', new Error('database path/customer details'));
  assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), false);
  workers[0].emit('exit', 1);
  assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), true);
  workers[1].emit('exit', 1);

  assert.deepEqual(logged, ['Usage analytics rollup failed', 'Usage analytics rollup failed']);
  assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), true);
});

test('default runner executes the completed-hour rollup in a database worker', async () => {
  const completed = new Promise((resolve, reject) => {
    const scheduler = createUsageRollupScheduler({
      databasePath: ':memory:',
      onSuccess: resolve,
      logger: { error: () => reject(new Error('Usage analytics rollup failed')) },
    });
    assert.equal(scheduler.dispatch('2026-10-09T12:00:00.000Z'), true);
  });

  assert.equal(await completed, '2026-10-09T12:00:00.000Z');
});
