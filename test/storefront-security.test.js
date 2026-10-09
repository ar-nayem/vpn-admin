const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../storefront/config');
const { createStorefrontApp } = require('../storefront/app');
const { openDatabase } = require('../storefront/db/database');

test('production configuration requires every secret and stays loopback-only', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /STOREFRONT_SESSION_SECRET/);
  const key = Buffer.alloc(32, 1).toString('base64');
  const config = loadConfig({
    NODE_ENV: 'production', STOREFRONT_SESSION_SECRET: 'session', OTP_PEPPER: 'pepper',
    OUTBOX_KEY: key, DOWNLOAD_KEY: key, INTERNAL_SHARED_SECRET: 'internal', GMAIL_APP_PASSWORD: 'app-password',
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.emailPollIntervalMs, 2000);
  assert.equal(loadConfig({
    STOREFRONT_SESSION_SECRET: 'session', OTP_PEPPER: 'pepper', OUTBOX_KEY: key,
    DOWNLOAD_KEY: key, INTERNAL_SHARED_SECRET: 'internal', EMAIL_POLL_INTERVAL_MS: '5000',
  }).emailPollIntervalMs, 5000);
});

test('customer routes deny unauthenticated and missing-CSRF requests with safe JSON', async () => {
  const db = openDatabase(':memory:');
  const services = {
    verification: {}, auth: { loginWithPassword: () => ({ id: 'c1' }) }, trials: {}, tracking: { getCustomerDashboard: async () => ({}) },
    orders: { submitOrder: async () => ({}) }, qr: { getActiveQr: () => ({ available: false }) }, downloads: {},
  };
  const app = createStorefrontApp({ db, sessionSecret: 'secret', services, uploadProof: (req, res, next) => next(), publicDir: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/dashboard`)).status, 401);
    const login = await fetch(`${base}/api/auth/login/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${base}/api/orders`, { method: 'POST', headers: { cookie } });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(JSON.stringify(body).includes('stack'), false);
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});
