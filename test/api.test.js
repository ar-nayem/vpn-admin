const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../app');

function appFixture() {
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
