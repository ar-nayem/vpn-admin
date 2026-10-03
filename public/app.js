const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const rowsEl = document.getElementById('peer-rows');
const summaryEl = document.getElementById('summary');
const addUserModal = document.getElementById('add-user-modal');
const addUserForm = document.getElementById('add-user-form');
const addUserError = document.getElementById('add-user-error');
const deviceFields = document.getElementById('new-user-devices');

let stream = null;

function fmtBits(kbps) {
  if (kbps >= 1024) return (kbps / 1024).toFixed(1) + ' Mbps';
  return Math.round(kbps) + ' Kbps';
}

function fmtBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(1) + ' ' + units[i];
}

function fmtAgo(sec) {
  if (sec === null) return 'never';
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.round(sec / 60) + 'm ago';
  return Math.round(sec / 3600) + 'h ago';
}

function fmtExpiry(sec) {
  if (sec === null) return 'No expiry';
  if (sec <= 0) return 'Expired';
  const days = sec / 86400;
  if (days >= 1) return Math.floor(days) + 'd left';
  return Math.round(sec / 3600) + 'h left';
}

function fmtQuota(usedBytes, quotaBytes) {
  const used = fmtBytes(usedBytes);
  if (!quotaBytes) return used + ' / ∞';
  return used + ' / ' + fmtBytes(quotaBytes);
}

async function api(path, opts) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data;
}

function buildRow(p) {
  const tr = document.createElement('tr');
  tr.dataset.pubkey = p.pubkey;

  tr.innerHTML = `
    <td class="col-status"><span class="dot" data-role="dot"></span></td>
    <td class="col-name"><input class="name-input" data-role="name" maxlength="80" aria-label="Device name" /></td>
    <td class="mono" data-label="IP">${p.ip}</td>
    <td data-label="Down" data-role="down-speed"></td>
    <td data-label="Up" data-role="up-speed"></td>
    <td class="mono" data-label="Total" data-role="total"></td>
    <td class="mono" data-label="Last seen" data-role="lastseen"></td>
    <td data-label="Limit (Mbps down / up)">
      <div class="limit-row">
        <input type="number" min="0" placeholder="∞" data-role="down-limit" />
        <input type="number" min="0" placeholder="∞" data-role="up-limit" />
        <button data-role="save">set</button>
      </div>
    </td>
    <td data-label="Data used / cap">
      <div class="expiry-row">
        <span class="mono" data-role="quota-text"></span>
        <div class="limit-row">
          <input type="number" min="0" step="any" placeholder="GB" data-role="quota-input" />
          <button data-role="quota-set">set</button>
          <button type="button" class="ghost-link" data-role="quota-clear">clear</button>
        </div>
        <button type="button" class="ghost-link" data-role="reset-usage">Reset usage</button>
      </div>
    </td>
    <td data-label="Expires">
      <div class="expiry-row">
        <span class="mono" data-role="expiry-text"></span>
        <div class="limit-row">
          <input type="number" min="0" step="any" placeholder="days" data-role="expiry-input" />
          <button data-role="expiry-set">set</button>
          <button type="button" class="ghost-link" data-role="expiry-clear">clear</button>
        </div>
      </div>
    </td>
    <td data-label="Config"><a data-role="download" class="ghost-link">Download</a></td>
    <td class="col-toggle">
      <div class="device-actions">
        <button class="toggle" data-role="toggle"></button>
        <button class="danger-link" data-role="archive-device" type="button">Archive</button>
      </div>
    </td>
  `;

  tr.querySelector('[data-role="name"]').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });
  tr.querySelector('[data-role="name"]').addEventListener('blur', async (e) => {
    const name = e.target.value.trim();
    if (!name) return;
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/name`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  });

  tr.querySelector('[data-role="save"]').addEventListener('click', async () => {
    const downMbps = parseFloat(tr.querySelector('[data-role="down-limit"]').value) || 0;
    const upMbps = parseFloat(tr.querySelector('[data-role="up-limit"]').value) || 0;
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/limit`, {
      method: 'POST',
      body: JSON.stringify({ downKbps: Math.round(downMbps * 1024), upKbps: Math.round(upMbps * 1024) }),
    });
  });

  tr.querySelector('[data-role="toggle"]').addEventListener('click', async () => {
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/toggle`, { method: 'POST' });
  });

  const expiryInput = tr.querySelector('[data-role="expiry-input"]');
  tr.querySelector('[data-role="expiry-set"]').addEventListener('click', async () => {
    const days = parseFloat(expiryInput.value);
    if (!days || days <= 0) return;
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/expiry`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    });
    expiryInput.value = '';
  });
  expiryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tr.querySelector('[data-role="expiry-set"]').click();
  });
  tr.querySelector('[data-role="expiry-clear"]').addEventListener('click', async () => {
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/expiry`, {
      method: 'POST',
      body: JSON.stringify({ clear: true }),
    });
  });

  const quotaInput = tr.querySelector('[data-role="quota-input"]');
  tr.querySelector('[data-role="quota-set"]').addEventListener('click', async () => {
    const gb = parseFloat(quotaInput.value);
    if (!gb || gb <= 0) return;
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/quota`, {
      method: 'POST',
      body: JSON.stringify({ gb }),
    });
    quotaInput.value = '';
  });
  quotaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tr.querySelector('[data-role="quota-set"]').click();
  });
  tr.querySelector('[data-role="quota-clear"]').addEventListener('click', async () => {
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/quota`, {
      method: 'POST',
      body: JSON.stringify({ clear: true }),
    });
  });

  tr.querySelector('[data-role="reset-usage"]').addEventListener('click', async () => {
    await api(`/api/peers/${encodeURIComponent(p.pubkey)}/reset-usage`, { method: 'POST' });
  });

  tr.querySelector('[data-role="archive-device"]').addEventListener('click', async () => {
    const label = tr.querySelector('[data-role="name"]').value || p.deviceName;
    if (!window.confirm(`Archive ${label}? This revokes only this device's VPN access.`)) return;
    try {
      await api(`/api/devices/${encodeURIComponent(p.deviceId)}`, {
        method: 'DELETE',
        body: JSON.stringify(UserView.buildArchiveDevicePayload(p.deviceId)),
      });
    } catch (err) {
      window.alert(err.message);
    }
  });

  return tr;
}

function updateRow(tr, p) {
  tr.className = p.archivedAt ? 'archived' : (p.enabled ? '' : 'disabled');

  tr.querySelector('[data-role="dot"]').className = `dot ${p.connected ? 'on' : 'off'}`;

  const nameInput = tr.querySelector('[data-role="name"]');
  if (document.activeElement !== nameInput) {
    nameInput.value = p.deviceId && p.deviceId.startsWith('legacy-') ? p.name : (p.deviceName || p.name);
  }

  tr.querySelector('[data-role="down-speed"]').textContent = p.connected ? fmtBits(p.liveDownKbps) : '—';
  tr.querySelector('[data-role="up-speed"]').textContent = p.connected ? fmtBits(p.liveUpKbps) : '—';
  tr.querySelector('[data-role="total"]').textContent = fmtBytes(p.rxBytesTotal + p.txBytesTotal);
  tr.querySelector('[data-role="lastseen"]').textContent = fmtAgo(p.lastHandshakeSecondsAgo);

  const downLimitInput = tr.querySelector('[data-role="down-limit"]');
  if (document.activeElement !== downLimitInput) {
    downLimitInput.value = p.downLimitKbps ? Math.round(p.downLimitKbps / 1024) : '';
  }
  const upLimitInput = tr.querySelector('[data-role="up-limit"]');
  if (document.activeElement !== upLimitInput) {
    upLimitInput.value = p.upLimitKbps ? Math.round(p.upLimitKbps / 1024) : '';
  }

  const toggleBtn = tr.querySelector('[data-role="toggle"]');
  toggleBtn.disabled = !!p.archivedAt;
  toggleBtn.className = `toggle ${p.enabled ? 'on' : 'off'}`;
  toggleBtn.textContent = p.archivedAt ? 'Archived' : (p.enabled ? 'On' : 'Off');
  tr.querySelector('[data-role="archive-device"]').disabled = !!p.archivedAt;

  tr.querySelector('[data-role="expiry-text"]').textContent = fmtExpiry(p.expiresInSeconds);
  tr.querySelector('[data-role="quota-text"]').textContent = fmtQuota(p.usedBytesTotal, p.quotaBytes);

  const downloadLink = tr.querySelector('[data-role="download"]');
  if (p.hasDownloadableConfig) {
    downloadLink.href = `/api/peers/${encodeURIComponent(p.pubkey)}/download`;
    downloadLink.classList.remove('disabled-link');
  } else {
    downloadLink.removeAttribute('href');
    downloadLink.classList.add('disabled-link');
    downloadLink.title = 'No stored key for this peer yet';
  }
}

const rowsByPubkey = new Map();
const headersByUser = new Map();

function buildUserHeader(user) {
  const tr = document.createElement('tr');
  tr.className = 'user-heading';
  tr.dataset.userNumber = user.userNumber;
  tr.innerHTML = `
    <td colspan="12">
      <div class="user-heading-content">
        <div>
          <strong data-role="user-title"></strong>
          <span data-role="device-count"></span>
        </div>
        <div class="user-heading-actions">
          <button type="button" class="ghost-link" data-role="add-user-device">Add device</button>
          <button type="button" class="danger-link" data-role="archive-user">Archive user</button>
        </div>
      </div>
    </td>
  `;
  tr.querySelector('[data-role="add-user-device"]').addEventListener('click', async () => {
    const deviceName = window.prompt(`Device name for User ${user.userNumber}`);
    if (!deviceName || !deviceName.trim()) return;
    try {
      await api(`/api/users/${user.userNumber}/devices`, {
        method: 'POST',
        body: JSON.stringify({ deviceName: deviceName.trim() }),
      });
    } catch (err) {
      window.alert(err.message);
    }
  });
  tr.querySelector('[data-role="archive-user"]').addEventListener('click', async () => {
    const activeCount = user.devices.filter((device) => !device.archivedAt).length;
    if (!window.confirm(`Archive User ${user.userNumber} — ${user.userName}? This revokes ${activeCount} active device${activeCount === 1 ? '' : 's'}.`)) return;
    try {
      await api(`/api/users/${user.userNumber}`, {
        method: 'DELETE',
        body: JSON.stringify(UserView.buildArchiveUserPayload(user.userNumber)),
      });
    } catch (err) {
      window.alert(err.message);
    }
  });
  return tr;
}

function updateUserHeader(tr, user) {
  const activeCount = user.devices.filter((device) => !device.archivedAt).length;
  tr.querySelector('[data-role="user-title"]').textContent = `User ${user.userNumber} — ${user.userName}`;
  tr.querySelector('[data-role="device-count"]').textContent = `${activeCount} active / ${user.devices.length} total`;
  tr.querySelector('[data-role="add-user-device"]').disabled = activeCount === 0;
}

function render(peers) {
  const activePeers = peers.filter((peer) => !peer.archivedAt);
  const connected = activePeers.filter((peer) => peer.connected).length;
  summaryEl.textContent = `${connected} / ${activePeers.length} devices connected`;
  const groups = UserView.groupPeerSnapshots(peers);
  const currentKeys = new Set(peers.map((peer) => peer.pubkey));

  for (const [pubkey, row] of rowsByPubkey) {
    if (!currentKeys.has(pubkey)) {
      row.remove();
      rowsByPubkey.delete(pubkey);
    }
  }

  for (const user of groups) {
    let heading = headersByUser.get(user.userNumber);
    if (!heading) {
      heading = buildUserHeader(user);
      headersByUser.set(user.userNumber, heading);
    }
    updateUserHeader(heading, user);
    rowsEl.appendChild(heading);
    for (const peer of user.devices) {
      let row = rowsByPubkey.get(peer.pubkey);
      if (!row) {
        row = buildRow(peer);
        rowsByPubkey.set(peer.pubkey, row);
      }
      updateRow(row, peer);
      rowsEl.appendChild(row);
    }
  }
}

function startStream() {
  if (stream) stream.close();
  stream = new EventSource('/api/stream');
  stream.onmessage = (e) => render(JSON.parse(e.data));
  stream.onerror = () => {
    stream.close();
    setTimeout(() => api('/api/session').then((s) => (s.authed ? startStream() : showLogin())), 3000);
  };
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  startStream();
}

function showLogin() {
  if (stream) stream.close();
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error();
    showApp();
  } catch (err) {
    loginError.textContent = 'Wrong password';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
});

function closeAddUser() {
  addUserModal.classList.add('hidden');
  addUserForm.reset();
  addUserError.textContent = '';
  deviceFields.innerHTML = '<input class="new-device-name" type="text" maxlength="80" placeholder="e.g. iPhone" required />';
}

document.getElementById('add-user-btn').addEventListener('click', () => {
  addUserError.textContent = '';
  addUserModal.classList.remove('hidden');
  document.getElementById('new-user-name').focus();
});

document.getElementById('add-user-cancel').addEventListener('click', closeAddUser);

document.getElementById('add-device-field').addEventListener('click', () => {
  if (deviceFields.children.length >= 10) return;
  const input = document.createElement('input');
  input.className = 'new-device-name';
  input.type = 'text';
  input.maxLength = 80;
  input.placeholder = 'e.g. Laptop';
  input.required = true;
  deviceFields.appendChild(input);
  input.focus();
});

addUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  addUserError.textContent = '';
  const submit = addUserForm.querySelector('[type="submit"]');
  const payload = UserView.buildCreateUserPayload(
    document.getElementById('new-user-name').value,
    [...deviceFields.querySelectorAll('.new-device-name')].map((input) => input.value)
  );
  if (!payload.userName || payload.devices.length === 0) {
    addUserError.textContent = 'Enter a user name and at least one device.';
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Creating…';
  try {
    const created = await api('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    closeAddUser();
    window.alert(`User ${created.userNumber} created. Download each device configuration from its row.`);
  } catch (err) {
    addUserError.textContent = `${err.message} Your existing VPN users were not changed.`;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Create user';
  }
});

const settingsModal = document.getElementById('settings-modal');
const passwordForm = document.getElementById('password-form');
const passwordError = document.getElementById('password-error');
const passwordSuccess = document.getElementById('password-success');

document.getElementById('settings-btn').addEventListener('click', () => {
  passwordError.textContent = '';
  passwordSuccess.textContent = '';
  passwordForm.reset();
  settingsModal.classList.remove('hidden');
});

document.getElementById('settings-cancel').addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  passwordError.textContent = '';
  passwordSuccess.textContent = '';
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'failed');
    passwordSuccess.textContent = 'Password changed.';
    passwordForm.reset();
    setTimeout(() => settingsModal.classList.add('hidden'), 1200);
  } catch (err) {
    passwordError.textContent = err.message;
  }
});

api('/api/session').then((s) => (s.authed ? showApp() : showLogin()));
