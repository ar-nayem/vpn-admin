const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');
const { openDatabase } = require('../storefront/db/database');
const { createStorefrontAdminService } = require('../storefront/services/admin');
const { createUsageServices } = require('../storefront/server');

test('storefront wiring exposes the usage history, analytics, and collector services', () => {
  const db = openDatabase(':memory:');
  try {
    const services = createUsageServices({ db });
    assert.deepEqual(services.usageHistory.listEligibleProfiles(), []);
    assert.deepEqual(services.usageAnalytics.getProfileHistory(1, '1h'), {
      range: '1h',
      timezone: 'UTC',
      points: [],
      summary: {
        uploadedBytes: 0,
        downloadedBytes: 0,
        peakUploadKbps: 0,
        peakDownloadKbps: 0,
        connectedMinutes: 0,
      },
    });
    assert.equal(services.usageCollector.record([]), 0);
  } finally {
    db.close();
  }
});

function appFixture(options = {}) {
  const calls = [];
  const provisioning = {
    listUsers: () => [{ userNumber: 1, userName: 'Peer 1', devices: [] }],
    createUser: (body) => {
      calls.push(['createUser', body]);
      return { userNumber: 22, userName: body.userName, devices: [] };
    },
    addDevice: (userNumber, body) => {
      calls.push(['addDevice', userNumber, body]);
      return { userNumber, deviceId: 'device-22', deviceName: body.deviceName };
    },
    archiveUser: (userNumber) => {
      calls.push(['archiveUser', userNumber]);
      return { userNumber, archived: true };
    },
    archiveDevice: (deviceId) => {
      calls.push(['archiveDevice', deviceId]);
      return { deviceId, archivedAt: '2026-10-03T10:00:00.000Z' };
    },
  };
  const app = createApp({
    provisioning,
    peerStore: { load: () => [], save: () => {} },
    keyStore: { getPrivateKey: () => null },
    awg: {},
    tc: {},
    sessionSecret: 'test-session-secret',
    admin: {
      verifyPassword: (password) => password === 'correct-password',
      changePassword: () => {},
    },
    getSnapshot: () => [],
    publicDir: false,
    adminStorefront: options.adminStorefront || null,
  });
  return { app, calls };
}

test('storefront order review stays behind administrator authentication', async () => {
  const adminStorefront = {
    listOrders: () => [{ id: 'order-1', state: 'pending' }],
    listAnalyticsProfiles: () => [{ id: 'profile-1', codeName: 'Phone', customerName: 'Owner', customerEmail: 'owner@example.com' }],
    getProfileHistory: async () => ({ range: '1d', timezone: 'UTC', points: [], summary: {}, customerName: 'Owner', customerEmail: 'owner@example.com', codeName: 'Phone' }),
    approveOrder: async () => ({ order: { id: 'order-1', state: 'approved' } }),
    retryProvisioning: async () => ({}), rejectOrder: () => ({}),
    proofPath: () => null, qrStatus: () => ({ wechat: { available: false }, alipay: { available: false } }),
  };
  const { app } = appFixture({ adminStorefront });
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/storefront/orders`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/storefront/analytics/profile-1?range=1d`)).status, 401);
    const cookie = await login(baseUrl);
    const listed = await fetch(`${baseUrl}/api/storefront/orders`, { headers: { Cookie: cookie } });
    assert.deepEqual(await listed.json(), {
      orders: [{ id: 'order-1', state: 'pending' }],
      analyticsProfiles: [{ id: 'profile-1', codeName: 'Phone', customerName: 'Owner', customerEmail: 'owner@example.com' }],
    });
    const analytics = await fetch(`${baseUrl}/api/storefront/analytics/profile-1?range=1d`, { headers: { Cookie: cookie } });
    assert.equal(analytics.status, 200);
    assert.deepEqual(await analytics.json(), { range: '1d', timezone: 'UTC', points: [], summary: {}, customerName: 'Owner', customerEmail: 'owner@example.com', codeName: 'Phone' });
    const approved = await fetch(`${baseUrl}/api/storefront/orders/order-1/approve`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal((await approved.json()).order.state, 'approved');
  });
});

test('admin analytics discovery lists only activated eligible future profiles', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO customers (id,email,normalized_email,name,created_at) VALUES (?,?,?,?,?)')
      .run('customer-1', 'owner@example.com', 'owner@example.com', 'Owner', '2026-10-08T00:00:00.000Z');
    const insert = db.prepare(`INSERT INTO vpn_profiles
      (id,customer_id,code_name,normalized_code_name,state,device_id,pubkey,ip,created_at,analytics_enabled,delivery_filename)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('eligible', 'customer-1', 'Phone', 'phone', 'active', 'device-1', 'secret-key', '10.0.0.2', '2026-10-08T00:00:00.000Z', 1, 'secret.conf');
    insert.run('legacy', 'customer-1', 'Old', 'old', 'active', 'device-2', 'legacy-key', '10.0.0.3', '2026-10-08T00:00:00.000Z', 0, null);
    insert.run('disabled', 'customer-1', 'Disabled', 'disabled', 'disabled', 'device-3', 'disabled-key', '10.0.0.4', '2026-10-08T00:00:00.000Z', 1, null);
    insert.run('pending', 'customer-1', 'Pending', 'pending', 'pending', null, null, null, '2026-10-08T00:00:00.000Z', 1, 'pending.conf');
    const service = createStorefrontAdminService({
      db,
      usageAnalytics: { getProfileHistory: (profileId, range) => ({ range, timezone: 'UTC', points: [{ timestamp: '2026-10-08T00:00:00.000Z', uploadKbps: 1, downloadKbps: 2 }], summary: { uploadedBytes: profileId === 'eligible' ? 8 : 0 } }) },
      orders: {}, qr: {}, proofStoragePath: '/tmp',
    });
    assert.deepEqual(service.listAnalyticsProfiles(), [{ id: 'eligible', codeName: 'Phone', customerName: 'Owner', customerEmail: 'owner@example.com' }]);
    assert.deepEqual(await service.getProfileHistory({ profileId: 'eligible', range: '1d' }), {
      range: '1d', timezone: 'UTC', points: [{ timestamp: '2026-10-08T00:00:00.000Z', uploadKbps: 1, downloadKbps: 2 }],
      summary: { uploadedBytes: 8 }, customerName: 'Owner', customerEmail: 'owner@example.com', codeName: 'Phone',
    });
    for (const profileId of ['legacy', 'disabled', 'pending', 'missing']) {
      await assert.rejects(service.getProfileHistory({ profileId, range: '1d' }), (error) => error.status === 404);
    }
    await assert.rejects(service.getProfileHistory({ profileId: 'eligible', range: '2d' }), (error) => error.status === 400);
  } finally { db.close(); }
});

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

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'correct-password' }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('user APIs require an authenticated administrator', async () => {
  const { app } = appFixture();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users`);
    assert.equal(response.status, 401);
  });
});

test('authenticated administrator creates User 22', async () => {
  const { app, calls } = appFixture();
  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userName: 'Alice', devices: ['iPhone'] }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      userNumber: 22,
      userName: 'Alice',
      devices: [],
    });
    assert.deepEqual(calls, [['createUser', { userName: 'Alice', devices: ['iPhone'] }]]);
  });
});

test('invalid create request is rejected before provisioning', async () => {
  const { app, calls } = appFixture();
  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userName: '', devices: [] }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  });
});

test('user archive requires the exact account number confirmation', async () => {
  const { app, calls } = appFixture();
  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const rejected = await fetch(`${baseUrl}/api/users/22`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ confirmUserNumber: 21 }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(calls, []);

    const accepted = await fetch(`${baseUrl}/api/users/22`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ confirmUserNumber: 22 }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(calls, [['archiveUser', 22]]);
  });
});

test('device archive requires the exact device confirmation', async () => {
  const { app, calls } = appFixture();
  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/devices/device-22`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ confirmDeviceId: 'wrong-device' }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  });
});

test('new user config downloads with a phone-compatible tunnel name', async () => {
  const peer = {
    name: 'A long customer name — Personal iPhone',
    pubkey: 'new-user-public-key',
    ip: '10.66.67.22',
    userNumber: 22,
    deviceId: 'device-22-phone',
    deviceName: 'Personal iPhone',
  };
  const app = createApp({
    provisioning: { listUsers: () => [] },
    peerStore: { load: () => [peer], save: () => {} },
    keyStore: { getPrivateKey: () => 'client-private-key' },
    awg: {
      getServerConfig: () => ({
        pubkey: 'server-public-key',
        endpointPort: '51820',
        jc: '4', jmin: '40', jmax: '70', s1: '0', s2: '0',
        h1: '1', h2: '2', h3: '3', h4: '4',
      }),
    },
    tc: {},
    sessionSecret: 'test-session-secret',
    admin: {
      verifyPassword: (password) => password === 'correct-password',
      changePassword: () => {},
    },
    publicDir: false,
  });

  await withServer(app, async (baseUrl) => {
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/api/peers/${peer.pubkey}/download`, {
      headers: { Cookie: cookie },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="user22-d1.conf"');
  });
});
