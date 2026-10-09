const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../storefront/db/database');
const { createStorefrontApp } = require('../storefront/app');

async function withApp(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-api-'));
  const db = openDatabase(path.join(directory, 'db.sqlite'));
  const services = {
    verification: { requestCode: (x) => x, verifyCode: () => ({ grant: 'grant' }) },
    auth: {
      register: () => ({ id: 'customer-1', email: 'a@b.com', name: 'A' }),
      loginWithPassword: () => ({ id: 'customer-1', email: 'a@b.com', name: 'A' }),
      loginWithCode: () => ({ id: 'customer-1', email: 'a@b.com', name: 'A' }),
      resetPassword: () => ({ id: 'customer-1' }),
    },
    trials: { async startTrial() { return { id: 'profile-1' }; } },
    tracking: {
      async getGuestDashboard() { return { profiles: [] }; },
      async getCustomerDashboard() { return { profiles: [{ id: 'profile-1', analyticsEnabled: true }] }; },
      async getCustomerHistory(input) {
        if (input.range === 'broken') throw Object.assign(new Error('analytics unavailable'), { status: 503, code: 'ANALYTICS_UNAVAILABLE' });
        if (input.range === 'invalid') throw Object.assign(new Error('unsupported range'), { status: 400, code: 'INVALID_RANGE' });
        return { range: input.range, timezone: 'UTC', points: [], summary: {} };
      },
    },
    orders: { async submitOrder() { return { id: 'order-1' }; } },
    qr: { getActiveQr: () => ({ available: false }) }, qrStoragePath: directory,
    downloads: { redeemDownloadToken: () => ({ filename: 'vpn.conf', content: 'config', contentType: 'text/plain', cacheControl: 'no-store' }) },
  };
  const app = createStorefrontApp({ db, sessionSecret: 'test-secret-with-enough-length', services, uploadProof: (req, res, next) => { req.file = {}; next(); }, publicDir: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

test('exposes catalog, trial, session login, and authenticated dashboard contracts', async () => {
  await withApp(async (base) => {
    assert.equal((await fetch(`${base}/api/catalog`)).status, 200);
    assert.equal((await fetch(`${base}/api/trials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 201);
    const login = await fetch(`${base}/api/auth/login/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const loginBody = await login.json();
    assert.equal(loginBody.customer.id, 'customer-1');
    const dashboard = await fetch(`${base}/api/dashboard`, { headers: { cookie } });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).profiles[0].id, 'profile-1');
  });
});

test('customer analytics requires a session and returns only the chart DTO', async () => {
  await withApp(async (base) => {
    assert.equal((await fetch(`${base}/api/analytics/profile-1?range=1d`)).status, 401);
    const login = await fetch(`${base}/api/auth/login/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${base}/api/analytics/profile-1?range=1d`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { range: '1d', timezone: 'UTC', points: [], summary: {} });
    assert.equal((await fetch(`${base}/api/analytics/profile-1?range=invalid`, { headers: { cookie } })).status, 400);
    assert.equal((await fetch(`${base}/api/analytics/profile-1?range=broken`, { headers: { cookie } })).status, 503);
  });
});

test('secure download is no-store and uses an attachment filename', async () => {
  await withApp(async (base) => {
    const response = await fetch(`${base}/download/token`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition'), /vpn\.conf/);
  });
});
