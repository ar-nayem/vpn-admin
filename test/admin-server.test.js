const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');
const { openDatabase } = require('../storefront/db/database');

test('production snapshot producer feeds collection while keeping the shared API snapshot and quota accounting', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-snapshot-'));
  const databasePath = path.join(directory, 'storefront.db');
  const db = openDatabase(databasePath);
  try {
    db.exec(`INSERT INTO customers (id, email, normalized_email, name, created_at)
      VALUES ('customer', 'owner@example.com', 'owner@example.com', 'Owner', '2026-10-09');
      INSERT INTO vpn_profiles (id, customer_id, code_name, normalized_code_name, state, device_id, analytics_enabled, created_at)
      VALUES ('future', 'customer', 'Phone', 'phone', 'active', 'device-1', 1, '2026-10-09');`);
    let peers = [{ name: 'Phone', pubkey: 'test-public-key', ip: '10.0.0.2', deviceId: 'device-1', enabled: true }];
    const live = { rxBytes: 2000, txBytes: 5000, latestHandshake: Date.now() / 1000, endpoint: 'test-endpoint' };
    const timers = [];
    let appDependencies;
    const serverFile = path.join(__dirname, '..', 'server.js');
    const serverRequire = createRequire(serverFile);
    const overrides = {
      fs: { readFileSync: () => '{"passwordHash":"test-hash"}' },
      './app': { createApp(dependencies) { appDependencies = dependencies; return { listen() {} }; } },
      './lib/store': { load: () => structuredClone(peers), save: (rows) => { peers = structuredClone(rows); } },
      './lib/keys': { getPrivateKey: () => null },
      './lib/awg': { dump: () => ({ 'test-public-key': live }) },
      './lib/tc': { ensureRootQdisc() {} },
      './storefront/db/database': { openDatabase: () => db },
      './storefront/services/usage-rollup-scheduler': { createUsageRollupScheduler: () => ({ dispatch() {} }) },
    };
    vm.runInNewContext(fs.readFileSync(serverFile, 'utf8'), {
      require: (name) => Object.hasOwn(overrides, name) ? overrides[name] : serverRequire(name),
      __dirname: path.dirname(serverFile), Buffer, console,
      process: { env: { SESSION_SECRET: 'test-secret', STOREFRONT_DATABASE_PATH: databasePath, STOREFRONT_STORAGE_PATH: directory } },
      setInterval: (callback, milliseconds) => timers.push({ callback, milliseconds }),
    }, { filename: serverFile });

    const sharedSnapshot = appDependencies.getSnapshot();
    assert.equal(sharedSnapshot[0].deviceId, 'device-1');
    assert.equal(sharedSnapshot[0].rxBytesTotal, 2000);
    const readSample = db.prepare('SELECT uploaded_bytes, downloaded_bytes FROM usage_samples_minute WHERE profile_id = ?');
    const deadline = Date.now() + 2000;
    while (!readSample.get('future') && Date.now() < deadline) await delay(10);
    assert.deepEqual(readSample.get('future'), { uploaded_bytes: 2000, downloaded_bytes: 5000 });

    live.rxBytes += 30;
    live.txBytes += 70;
    const nextSnapshot = timers.find((timer) => timer.milliseconds === 2000).callback();
    assert.equal(nextSnapshot, appDependencies.getSnapshot());
    assert.notEqual(nextSnapshot, sharedSnapshot);
    assert.equal(nextSnapshot[0].usedBytesTotal, 100);
    assert.equal(peers[0].usedBytesTotal, 100);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM usage_samples_minute').get().count, 1);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
