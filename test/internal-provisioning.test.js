const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');
const { signInternalRequest } = require('../lib/internal-auth');

const SECRET = 'internal-test-secret-with-enough-entropy';

function appFixture(now = () => new Date('2026-10-08T00:00:00.000Z')) {
  const calls = [];
  const provisioning = {
    createCustomerProfile(input) {
      calls.push(['create', input]);
      return { deviceId: 'device-1', pubkey: 'public-1', ip: '10.66.67.23' };
    },
    upgradeCustomerProfile(input) {
      calls.push(['upgrade', input]);
      return { deviceId: input.deviceId, pubkey: 'public-1', ip: '10.66.67.23' };
    },
  };
  const app = createApp({
    provisioning,
    peerStore: { load: () => [], save: () => {} },
    keyStore: { getPrivateKey: () => null },
    awg: {},
    tc: {},
    sessionSecret: 'test-session',
    internalSecret: SECRET,
    internalNow: now,
    admin: { verifyPassword: () => false, changePassword: () => {} },
    publicDir: false,
  });
  return { app, calls };
}

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function signedHeaders(method, path, body, timestamp = '1791417600', nonce = 'nonce-1') {
  return {
    'Content-Type': 'application/json',
    'x-storefront-timestamp': timestamp,
    'x-storefront-nonce': nonce,
    'x-storefront-signature': signInternalRequest({ secret: SECRET, timestamp, nonce, method, path, body }),
  };
}

test('accepts one signed trial request and fixes trial limits server-side', async () => {
  const { app, calls } = appFixture();
  await withServer(app, async (baseUrl) => {
    const path = '/internal/v1/profiles/trial';
    const body = JSON.stringify({ customerRef: 'customer-1', customerName: 'Buyer', codeName: 'Phone', quotaBytes: 999 });
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: signedHeaders('POST', path, body),
      body,
    });

    assert.equal(response.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].entitlement.quotaBytes, 1024 ** 3);
    assert.equal(calls[0][1].entitlement.downKbps, 5120);
    assert.equal(calls[0][1].entitlement.expiresAt, null);
  });
});

test('rejects unsigned, stale, and replayed internal requests', async () => {
  const { app, calls } = appFixture();
  await withServer(app, async (baseUrl) => {
    const path = '/internal/v1/profiles/trial';
    const body = JSON.stringify({ customerRef: 'customer-1', customerName: 'Buyer', codeName: 'Phone' });
    const unsigned = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(unsigned.status, 401);

    const staleHeaders = signedHeaders('POST', path, body, '1791417000', 'nonce-stale');
    const stale = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: staleHeaders, body });
    assert.equal(stale.status, 401);

    const headers = signedHeaders('POST', path, body, '1791417600', 'nonce-replay');
    assert.equal((await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body })).status, 201);
    assert.equal((await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body })).status, 401);
    assert.equal(calls.length, 1);
  });
});

test('rejects a signature when the signed body differs', async () => {
  const { app, calls } = appFixture();
  await withServer(app, async (baseUrl) => {
    const path = '/internal/v1/profiles/trial';
    const signedBody = JSON.stringify({ customerRef: 'customer-1', customerName: 'Buyer', codeName: 'Phone' });
    const changedBody = JSON.stringify({ customerRef: 'customer-1', customerName: 'Buyer', codeName: 'Tablet' });
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: signedHeaders('POST', path, signedBody, '1791417600', 'nonce-changed'),
      body: changedBody,
    });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});
