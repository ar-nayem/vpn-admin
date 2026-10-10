const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { openDatabase } = require('../storefront/db/database');
const { createUsageSnapshotCycle } = require('../storefront/services/usage-collector');
const { createUsageRollupScheduler } = require('../storefront/services/usage-rollup-scheduler');

let createUsageCollectionScheduler;
try { ({ createUsageCollectionScheduler } = require('../storefront/services/usage-collection-scheduler')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

const snapshot = [{ deviceId: 'device-1', rxBytesTotal: 100, txBytesTotal: 200, liveUpKbps: 3, liveDownKbps: 4, connected: true }];

test('collection dispatch is limited to one worker per minute and sends only measurements plus stable profile mapping', () => {
  assert.equal(typeof createUsageCollectionScheduler, 'function');
  let now = new Date('2026-10-09T14:31:01.000Z');
  const workers = [];
  const payloads = [];
  const completed = [];
  const scheduler = createUsageCollectionScheduler({
    databasePath: '/private/test.db', now: () => now,
    runWorker(databasePath, sampledMinute, rows) {
      payloads.push({ databasePath, sampledMinute, rows });
      const worker = new EventEmitter();
      workers.push(worker);
      return worker;
    },
    onSuccess: (minute) => completed.push(minute),
  });
  const mappedSnapshot = [{
    ...snapshot[0], pubkey: 'public-key', ip: '10.66.67.2', userNumber: 1,
    userName: 'User 1', deviceName: 'Existing device', enabled: true,
    archivedAt: null, downLimitKbps: 5120, upLimitKbps: 5120,
    quotaBytes: null, expiresAt: null,
    endpoint: 'private-endpoint', hasDownloadableConfig: true,
  }];
  assert.equal(scheduler.record(mappedSnapshot), true);
  assert.equal(scheduler.record(snapshot), false);
  assert.deepEqual(payloads, [{
    databasePath: '/private/test.db', sampledMinute: '2026-10-09T14:31:00.000Z',
    rows: [{
      ...snapshot[0], pubkey: 'public-key', ip: '10.66.67.2', userNumber: 1,
      userName: 'User 1', deviceName: 'Existing device', enabled: true,
      archivedAt: null, downLimitKbps: 5120, upLimitKbps: 5120,
      quotaBytes: null, expiresAt: null,
    }],
  }]);
  workers[0].emit('message', { ok: true });
  assert.deepEqual(completed, []);
  workers[0].emit('exit', 0);
  assert.deepEqual(completed, ['2026-10-09T14:31:00.000Z']);
  assert.equal(scheduler.record(snapshot), false);
  now = new Date('2026-10-09T14:32:01.000Z');
  assert.equal(scheduler.record(snapshot), true);
  now = new Date('2026-10-09T14:33:01.000Z');
  assert.equal(scheduler.record(snapshot), false);
  workers[1].emit('message', { ok: true });
  workers[1].emit('exit', 0);
  assert.equal(scheduler.record(snapshot), true);
  assert.equal(workers.length, 3);
});

test('failed workers and startup exceptions log generically and retry on a later minute', () => {
  assert.equal(typeof createUsageCollectionScheduler, 'function');
  let now = new Date('2026-10-09T14:31:01.000Z');
  let attempts = 0;
  const workers = [];
  const logged = [];
  const scheduler = createUsageCollectionScheduler({
    databasePath: '/private/test.db', now: () => now,
    runWorker() {
      attempts += 1;
      if (attempts === 1) throw new Error('private database path');
      const worker = new EventEmitter();
      workers.push(worker);
      return worker;
    },
    logger: { error: (message) => logged.push(message) },
  });
  assert.equal(scheduler.record(snapshot), false);
  assert.equal(scheduler.record(snapshot), false);
  now = new Date('2026-10-09T14:32:01.000Z');
  assert.equal(scheduler.record(snapshot), true);
  workers[0].emit('error', new Error('private customer details'));
  now = new Date('2026-10-09T14:33:01.000Z');
  assert.equal(scheduler.record(snapshot), false);
  workers[0].emit('exit', 1);
  assert.equal(scheduler.record(snapshot), true);
  workers[1].emit('message', { ok: false });
  workers[1].emit('exit', 0);
  assert.equal(scheduler.record(snapshot), false);
  assert.equal(attempts, 3);
  assert.deepEqual(logged, Array(3).fill('Usage analytics collection failed'));
});

test('a real competing SQLite write lock leaves the caller responsive and retries without duplicate samples', { timeout: 10000 }, async () => {
  assert.equal(typeof createUsageCollectionScheduler, 'function');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-collection-lock-'));
  const databasePath = path.join(directory, 'storefront.db');
  const db = openDatabase(databasePath);
  const lock = openDatabase(databasePath);
  try {
    db.exec(`INSERT INTO customers (id,email,normalized_email,name,created_at)
      VALUES ('customer','owner@example.com','owner@example.com','Owner','2026-10-09');
      INSERT INTO vpn_profiles (id,customer_id,code_name,normalized_code_name,state,device_id,created_at,analytics_enabled)
      VALUES ('future','customer','Phone','phone','active','device-1','2026-10-09',1),
        ('legacy','customer','Old','old','active','device-2','2026-10-09',0);`);
    let now = new Date('2026-10-09T14:31:01.000Z');
    const events = new EventEmitter();
    const errors = [];
    const scheduler = createUsageCollectionScheduler({
      databasePath, now: () => now,
      logger: { error(message) { errors.push(message); events.emit('failed'); } },
      onSuccess: () => events.emit('collected'),
    });
    const cycle = createUsageSnapshotCycle({ computeSnapshot: () => snapshot, collector: scheduler });
    lock.exec('BEGIN IMMEDIATE');
    const failed = once(events, 'failed');
    const started = performance.now();
    assert.equal(cycle(), snapshot);
    assert.ok(performance.now() - started < 500, 'snapshot caller must not wait on SQLite');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cycle(), snapshot);
    await failed;
    assert.ok(performance.now() - started < 2000, 'worker must fail promptly instead of waiting five seconds');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_samples_minute').get().count, 0);
    assert.equal(scheduler.record(snapshot), false);
    lock.exec('ROLLBACK');

    now = new Date('2026-10-09T14:32:01.000Z');
    const collected = once(events, 'collected');
    assert.equal(scheduler.record(snapshot), true);
    await collected;
    assert.equal(scheduler.record(snapshot), false);
    assert.deepEqual(db.prepare('SELECT profile_id, sampled_minute, uploaded_bytes, downloaded_bytes FROM usage_samples_minute').all(), [
      { profile_id: 'future', sampled_minute: '2026-10-09T14:32:00.000Z', uploaded_bytes: 0, downloaded_bytes: 0 },
    ]);

    const rolled = once(events, 'rolled');
    createUsageRollupScheduler({ databasePath, onSuccess: () => events.emit('rolled'), logger: { error: () => assert.fail('rollup should succeed') } })
      .dispatch('2026-10-09T15:00:00.000Z');
    await rolled;
    assert.equal(db.prepare('SELECT uploaded_bytes FROM usage_samples_hour').get().uploaded_bytes, 0);
    assert.deepEqual(errors, ['Usage analytics collection failed']);
  } finally {
    if (lock.inTransaction) lock.exec('ROLLBACK');
    lock.close();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
