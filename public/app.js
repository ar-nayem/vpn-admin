const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const rowsEl = document.getElementById('peer-rows');
const summaryEl = document.getElementById('summary');
const addUserBtn = document.getElementById('add-user-btn');
const deletedUsersBtn = document.getElementById('deleted-users-btn');
const workspaceNav = document.getElementById('workspace-nav');
const workspaceNavMore = document.getElementById('workspace-nav-more');
const listEmpty = document.getElementById('list-empty');
const addUserModal = document.getElementById('add-user-modal');
const addUserForm = document.getElementById('add-user-form');
const addUserError = document.getElementById('add-user-error');
const deviceFields = document.getElementById('new-user-devices');
const customerRows = document.getElementById('customer-rows');
const customerSelect = document.getElementById('usage-customer-select');
const profileSelect = document.getElementById('usage-profile-select');
const historyState = document.getElementById('usage-state');
const historyError = document.getElementById('usage-error');
const historyErrorMessage = document.getElementById('usage-error-message');
const historyRetry = document.getElementById('usage-retry');
const historyChartDescription = document.getElementById('usage-chart-description');
const historyChartSummary = document.getElementById('usage-chart-summary');
const historyScaleLabel = document.getElementById('usage-scale-label');
const historyTimeLabels = [
  document.getElementById('usage-time-start'),
  document.getElementById('usage-time-middle'),
  document.getElementById('usage-time-end'),
];
const uploadLine = document.getElementById('usage-upload-line');
const downloadLine = document.getElementById('usage-download-line');
const uploadDot = document.getElementById('usage-upload-dot');
const downloadDot = document.getElementById('usage-download-dot');
const usageChart = document.getElementById('usage-chart');
const usageChartGrid = document.getElementById('usage-grid');
const usageChartYAxis = document.getElementById('usage-y-axis');
const usageChartXAxis = document.getElementById('usage-x-axis');
const usageChartCrosshair = document.getElementById('usage-crosshair');
const usageChartHitArea = document.getElementById('usage-hit-area');
const usageChartTooltip = document.getElementById('usage-tooltip');
const usageUploadFocus = document.getElementById('usage-upload-focus');
const usageDownloadFocus = document.getElementById('usage-download-focus');

let stream = null;
let currentView = 'active';
let activeWorkspace = 'vpn-users';
let latestPeers = [];
let analyticsProfiles = [];
let analyticsProfileRefreshId = 0;
let selectedRange = '1d';
let historyRequestId = 0;
let historyController = null;
let activeUsageChart = { points: [] };
let activeUsageTimezone = 'UTC';
let activeUsagePointIndex = -1;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ADMIN_BASE = window.location.pathname.startsWith('/admin') ? '/admin' : '';
const adminUrl = (url) => `${ADMIN_BASE}${url}`;

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
  const res = await fetch(adminUrl(path), {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function buildRow(p) {
  const tr = document.createElement('tr');
  tr.dataset.pubkey = p.pubkey;

  tr.innerHTML = `
    <td class="col-status"><span class="dot" data-role="dot" aria-hidden="true"></span><span class="connection-state" data-role="connection-state"></span></td>
    <td class="col-name">
      <input class="name-input" data-role="name" maxlength="80" />
      <div class="device-owner" data-role="owner"></div>
    </td>
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
        <button type="button" class="danger-link" data-role="archive-device">Delete device</button>
        <button type="button" class="danger-link" data-role="archive-user">Delete user</button>
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

  tr.querySelector('[data-role="archive-user"]').addEventListener('click', async () => {
    if (!window.confirm(`Delete User ${p.userNumber} — ${p.userName}? This revokes all of this user's devices.`)) return;
    try {
      await api(`/api/users/${p.userNumber}`, {
        method: 'DELETE',
        body: JSON.stringify(UserView.buildArchiveUserPayload(p.userNumber)),
      });
    } catch (err) {
      window.alert(err.message);
    }
  });

  tr.querySelector('[data-role="archive-device"]').addEventListener('click', async () => {
    if (!window.confirm(`Delete Device ${p.deviceName || p.name}? This revokes only this device's VPN connection.`)) return;
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

function updateRow(tr, p, showDelete) {
  tr.className = p.archivedAt ? 'archived' : (p.enabled ? '' : 'disabled');

  tr.querySelector('[data-role="dot"]').className = `dot ${p.connected ? 'on' : 'off'}`;
  tr.querySelector('[data-role="connection-state"]').textContent = p.connected ? 'Live' : (p.enabled ? 'Offline' : 'Disabled');

  const nameInput = tr.querySelector('[data-role="name"]');
  if (document.activeElement !== nameInput) {
    nameInput.value = p.deviceId && p.deviceId.startsWith('legacy-') ? p.name : (p.deviceName || p.name);
  }
  tr.querySelector('[data-role="owner"]').textContent = `User ${p.userNumber} · ${p.userName}`;

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
  tr.querySelector('[data-role="archive-user"]').classList.toggle('hidden', !showDelete || !!p.archivedAt);
  tr.querySelector('[data-role="archive-device"]').classList.toggle('hidden', !!p.archivedAt);
  tr.querySelectorAll('input, button').forEach((control) => {
    control.disabled = !!p.archivedAt;
  });

  tr.querySelector('[data-role="expiry-text"]').textContent = fmtExpiry(p.expiresInSeconds);
  tr.querySelector('[data-role="quota-text"]').textContent = fmtQuota(p.usedBytesTotal, p.quotaBytes);

  const downloadLink = tr.querySelector('[data-role="download"]');
  if (p.hasDownloadableConfig) {
    downloadLink.href = adminUrl(`/api/peers/${encodeURIComponent(p.pubkey)}/download`);
    downloadLink.classList.remove('disabled-link');
  } else {
    downloadLink.removeAttribute('href');
    downloadLink.classList.add('disabled-link');
    downloadLink.title = 'No stored key for this peer yet';
  }
}

const rowsByPubkey = new Map();

function render(peers) {
  latestPeers = peers;
  const active = peers.filter((p) => !p.archivedAt);
  const connected = active.filter((p) => p.connected).length;
  const deleted = peers.filter((p) => !!p.archivedAt);
  const visiblePeers = UserView.filterPeersForView(peers, currentView);
  summaryEl.textContent = currentView === 'deleted'
    ? `${deleted.length} deleted`
    : `${connected} / ${active.length} connected`;
  document.getElementById('list-count').textContent = `${visiblePeers.length} ${currentView === 'deleted' ? 'deleted' : 'devices'}`;
  document.getElementById('vpn-users-title').textContent = currentView === 'deleted' ? 'Recently deleted' : 'VPN users';
  deletedUsersBtn.textContent = currentView === 'deleted'
    ? 'Back to active users'
    : `Recently deleted${deleted.length ? ` (${deleted.length})` : ''}`;
  addUserBtn.classList.toggle('hidden', activeWorkspace !== 'vpn-users' || currentView === 'deleted');
  const deletedActive = activeWorkspace === 'vpn-users' && currentView === 'deleted';
  document.querySelector('[data-workspace="vpn-users"]').classList.toggle('active', activeWorkspace === 'vpn-users' && !deletedActive);
  if (activeWorkspace === 'vpn-users' && !deletedActive) document.querySelector('[data-workspace="vpn-users"]').setAttribute('aria-current', 'page');
  else document.querySelector('[data-workspace="vpn-users"]').removeAttribute('aria-current');
  deletedUsersBtn.classList.toggle('active', deletedActive);
  if (deletedActive) deletedUsersBtn.setAttribute('aria-current', 'page');
  else deletedUsersBtn.removeAttribute('aria-current');
  listEmpty.textContent = currentView === 'deleted'
    ? 'No deleted users or devices.'
    : 'No active VPN users.';
  listEmpty.classList.toggle('hidden', visiblePeers.length > 0);
  rowsEl.replaceChildren();

  const seenUsers = new Set();
  for (const p of visiblePeers) {
    let tr = rowsByPubkey.get(p.pubkey);
    if (!tr) {
      tr = buildRow(p);
      rowsByPubkey.set(p.pubkey, tr);
    }
    const showDelete = !p.archivedAt && !seenUsers.has(p.userNumber);
    if (!p.archivedAt) seenUsers.add(p.userNumber);
    updateRow(tr, p, showDelete);
    rowsEl.appendChild(tr);
  }
}

function setWorkspace(name) {
  const next = UserView.transitionWorkspace({ workspace: activeWorkspace, view: currentView }, name);
  activeWorkspace = next.workspace;
  currentView = next.view;
  document.querySelectorAll('.workspace-nav [data-workspace]').forEach((button) => {
    const active = button.dataset.workspace === activeWorkspace && !(activeWorkspace === 'vpn-users' && currentView === 'deleted');
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const deletedActive = activeWorkspace === 'vpn-users' && currentView === 'deleted';
  deletedUsersBtn.classList.toggle('active', deletedActive);
  if (deletedActive) deletedUsersBtn.setAttribute('aria-current', 'page');
  else deletedUsersBtn.removeAttribute('aria-current');
  document.querySelectorAll('.workspace').forEach((section) => section.classList.add('hidden'));
  const workspaceIds = { 'vpn-users': 'vpn-users-workspace', 'storefront-customers': 'customers-workspace', 'usage-history': 'history-workspace' };
  const visibleWorkspace = document.getElementById(workspaceIds[activeWorkspace]);
  visibleWorkspace.classList.remove('hidden');
  addUserBtn.classList.toggle('hidden', activeWorkspace !== 'vpn-users' || currentView === 'deleted');
  if (activeWorkspace === 'vpn-users') render(latestPeers);
  revealActiveWorkspace();
  if (activeWorkspace === 'storefront-customers') loadAnalyticsProfiles();
  if (activeWorkspace === 'usage-history') loadAnalyticsProfiles().then((profiles) => { if (profiles) loadHistory(); });
}

function reducedMotionRequested() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function syncWorkspaceNavCue() {
  const hasOverflow = workspaceNav.scrollWidth > workspaceNav.clientWidth + 1;
  workspaceNavMore.hidden = !hasOverflow;
  if (!hasOverflow) return;
  const atEnd = workspaceNav.scrollLeft + workspaceNav.clientWidth >= workspaceNav.scrollWidth - 1;
  workspaceNavMore.textContent = atEnd ? 'Back' : 'More';
  workspaceNavMore.setAttribute('aria-label', atEnd ? 'Show previous workspaces' : 'Show more workspaces');
}

function revealActiveWorkspace() {
  const active = workspaceNav.querySelector('.nav-item.active');
  if (active) {
    const navRect = workspaceNav.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const left = UserView.getNavScrollTarget({
      scrollLeft: workspaceNav.scrollLeft,
      scrollWidth: workspaceNav.scrollWidth,
      clientWidth: workspaceNav.clientWidth,
      containerLeft: navRect.left + 2,
      containerRight: navRect.left + workspaceNav.clientWidth - 2,
      itemLeft: itemRect.left,
      itemRight: itemRect.right,
    });
    workspaceNav.scrollTo({ left, behavior: reducedMotionRequested() ? 'auto' : 'smooth' });
  }
  syncWorkspaceNavCue();
}

workspaceNav.addEventListener('scroll', syncWorkspaceNavCue, { passive: true });
window.addEventListener('resize', syncWorkspaceNavCue);
workspaceNavMore.addEventListener('click', () => {
  const atEnd = workspaceNav.scrollLeft + workspaceNav.clientWidth >= workspaceNav.scrollWidth - 1;
  const maxLeft = workspaceNav.scrollWidth - workspaceNav.clientWidth;
  const nextLeft = atEnd ? 0 : Math.min(maxLeft, workspaceNav.scrollLeft + workspaceNav.clientWidth * 0.8);
  workspaceNav.scrollTo({ left: nextLeft, behavior: reducedMotionRequested() ? 'auto' : 'smooth' });
});
syncWorkspaceNavCue();

document.querySelectorAll('.workspace-nav [data-workspace]').forEach((button) => {
  button.addEventListener('click', () => setWorkspace(button.dataset.workspace));
});

deletedUsersBtn.addEventListener('click', () => {
  setWorkspace('recently-deleted');
});

function startStream() {
  if (stream) stream.close();
  stream = new EventSource(adminUrl('/api/stream'));
  stream.onmessage = (e) => render(JSON.parse(e.data));
  stream.onerror = () => {
    stream.close();
    setTimeout(() => api('/api/session').then((s) => (s.authed ? startStream() : showLogin())), 3000);
  };
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  syncWorkspaceNavCue();
  startStream();
  loadAnalyticsProfiles();
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
    const res = await fetch(adminUrl('/api/login'), {
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
  await fetch(adminUrl('/api/logout'), { method: 'POST' });
  showLogin();
});

function closeAddUser() {
  addUserModal.classList.add('hidden');
  addUserForm.reset();
  addUserError.textContent = '';
  deviceFields.innerHTML = '<label class="field-label" for="new-device-name-1">Device name</label><input id="new-device-name-1" class="new-device-name" type="text" maxlength="80" placeholder="Device name (for example, iPhone)" required />';
}

addUserBtn.addEventListener('click', () => {
  addUserError.textContent = '';
  addUserModal.classList.remove('hidden');
  document.getElementById('new-user-name').focus();
});

document.getElementById('add-user-cancel').addEventListener('click', closeAddUser);

document.getElementById('add-device-field').addEventListener('click', () => {
  if (deviceFields.querySelectorAll('.new-device-name').length >= 10) return;
  const index = deviceFields.querySelectorAll('.new-device-name').length + 1;
  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = `new-device-name-${index}`;
  label.textContent = `Device ${index} name`;
  const input = document.createElement('input');
  input.id = `new-device-name-${index}`;
  input.className = 'new-device-name';
  input.type = 'text';
  input.maxLength = 80;
  input.placeholder = 'Another device name';
  input.required = true;
  deviceFields.append(label, input);
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
  submit.disabled = true;
  try {
    const created = await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    closeAddUser();
    window.alert(`User ${created.userNumber} created.`);
  } catch (err) {
    addUserError.textContent = `${err.message}. Existing VPN users were not changed.`;
  } finally {
    submit.disabled = false;
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
    const res = await fetch(adminUrl('/api/change-password'), {
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

const ordersModal = document.getElementById('orders-modal');
const ordersList = document.getElementById('orders-list');
const ordersMessage = document.getElementById('orders-message');
const qrModal = document.getElementById('payment-qr-modal');
const qrMessage = document.getElementById('payment-qr-message');
const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function profileCustomerKey(profile) {
  return profile.customerEmail || profile.customerName || 'unknown';
}

function renderAnalyticsProfiles(rawProfiles) {
  const selection = UserView.reconcileAnalyticsSelection(rawProfiles, customerSelect.value, profileSelect.value);
  analyticsProfiles = selection.profiles;
  document.getElementById('customers-error').textContent = '';
  const customers = [...new Map(analyticsProfiles.map((profile) => [profileCustomerKey(profile), profile])).entries()];
  customerSelect.innerHTML = customers.map(([key, profile]) =>
    `<option value="${escapeHtml(key)}">${escapeHtml(profile.customerName || 'Unnamed customer')}${profile.customerEmail ? ` · ${escapeHtml(profile.customerEmail)}` : ''}</option>`).join('');
  customerSelect.disabled = !customers.length;
  customerSelect.value = selection.customerKey;
  renderProfileOptions(selection.profileId);
  customerRows.innerHTML = analyticsProfiles.map((profile) => `<tr>
    <td data-label="Customer">${escapeHtml(profile.customerName || 'Unnamed customer')}</td>
    <td data-label="Email">${escapeHtml(profile.customerEmail || '—')}</td>
    <td data-label="VPN profile">${escapeHtml(profile.codeName)}</td>
    <td data-label="Usage"><button type="button" class="table-action" data-profile-id="${escapeHtml(profile.id)}">View usage</button></td>
  </tr>`).join('');
  document.getElementById('customer-count').textContent = `${analyticsProfiles.length} eligible profiles`;
  document.getElementById('customers-empty').classList.toggle('hidden', analyticsProfiles.length > 0);
  document.querySelector('.customer-table-wrap').classList.toggle('hidden', analyticsProfiles.length === 0);
  return analyticsProfiles;
}

function renderProfileOptions(selectedId) {
  const customerKey = customerSelect.value;
  const profiles = analyticsProfiles.filter((profile) => profileCustomerKey(profile) === customerKey);
  profileSelect.innerHTML = profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.codeName)}</option>`).join('');
  profileSelect.disabled = !profiles.length;
  profileSelect.value = profiles.some((profile) => profile.id === selectedId) ? selectedId : (profiles[0]?.id || '');
}

async function loadAnalyticsProfiles() {
  const refreshId = ++analyticsProfileRefreshId;
  try {
    const data = await api('/api/storefront/orders');
    if (refreshId !== analyticsProfileRefreshId) return analyticsProfiles;
    renderAnalyticsProfiles(data.analyticsProfiles);
    return analyticsProfiles;
  } catch (error) {
    if (refreshId !== analyticsProfileRefreshId) return analyticsProfiles;
    document.getElementById('customers-error').textContent = error.message;
    document.getElementById('customer-count').textContent = '';
    if (activeWorkspace === 'usage-history') {
      historyState.textContent = 'Customer profiles could not be loaded.';
      historyErrorMessage.textContent = error.message;
      historyError.hidden = false;
      clearHistoryChart('Customer profiles could not be loaded. Try again.');
    }
    return null;
  }
}

function formatHistorySummary(summary = {}) {
  return UserView.formatHistorySummary(summary);
}

function setHistorySummary(summary) {
  const formatted = formatHistorySummary(summary);
  document.getElementById('usage-transferred').textContent = formatted.transferred;
  document.getElementById('usage-upload-peak').textContent = formatted.uploadPeak;
  document.getElementById('usage-download-peak').textContent = formatted.downloadPeak;
  document.getElementById('usage-connected').textContent = formatted.connected;
  return formatted;
}

function svgNode(name, attributes, text) {
  const node = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHistoryAxes(model) {
  usageChartGrid.replaceChildren();
  usageChartYAxis.replaceChildren();
  usageChartXAxis.replaceChildren();
  for (const tick of model.yTicks) {
    usageChartGrid.append(svgNode('line', { x1: model.bounds.left, x2: model.bounds.right, y1: tick.y, y2: tick.y }));
    usageChartYAxis.append(svgNode('text', { x: model.bounds.left - 9, y: tick.y + 4, 'text-anchor': 'end' }, tick.label));
  }
  model.xTicks.forEach((tick, index) => {
    usageChartGrid.append(svgNode('line', { class: 'vertical', x1: tick.x, x2: tick.x, y1: model.bounds.top, y2: model.bounds.bottom }));
    const anchor = index === 0 ? 'start' : index === model.xTicks.length - 1 ? 'end' : 'middle';
    usageChartXAxis.append(svgNode('text', { x: tick.x, y: 230, 'text-anchor': anchor }, tick.label));
  });
}

function hideHistoryInspection() {
  activeUsagePointIndex = -1;
  usageChartCrosshair.setAttribute('visibility', 'hidden');
  usageUploadFocus.setAttribute('visibility', 'hidden');
  usageDownloadFocus.setAttribute('visibility', 'hidden');
  usageChartTooltip.hidden = true;
}

function usagePointTimeLabel(point) {
  const options = { dateStyle: 'medium', timeStyle: 'short', timeZone: activeUsageTimezone };
  try { return new Intl.DateTimeFormat('en-GB', options).format(new Date(point.timestamp)); }
  catch { return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(point.timestamp)); }
}

function usagePointSpeedLabel(value) {
  return value >= 1024 ? `${Number((value / 1024).toFixed(2))} Mbps` : `${Math.round(value)} Kbps`;
}

function showHistoryInspection(point) {
  if (!point) return hideHistoryInspection();
  activeUsagePointIndex = activeUsageChart.points.indexOf(point);
  usageChartCrosshair.setAttribute('x1', String(point.x));
  usageChartCrosshair.setAttribute('x2', String(point.x));
  usageChartCrosshair.setAttribute('visibility', 'visible');
  for (const [node, y] of [[usageUploadFocus, point.uploadY], [usageDownloadFocus, point.downloadY]]) {
    node.setAttribute('cx', String(point.x));
    node.setAttribute('cy', String(y));
    node.setAttribute('visibility', 'visible');
  }
  usageChartTooltip.replaceChildren(
    Object.assign(document.createElement('strong'), { textContent: usagePointTimeLabel(point) }),
    Object.assign(document.createElement('span'), { textContent: `Upload ${usagePointSpeedLabel(point.uploadKbps)}` }),
    Object.assign(document.createElement('span'), { textContent: `Download ${usagePointSpeedLabel(point.downloadKbps)}` }),
  );
  usageChartTooltip.style.left = `${Math.max(18, Math.min(82, point.x / 6))}%`;
  usageChartTooltip.hidden = false;
}

function inspectHistoryAtClientX(clientX) {
  const bounds = usageChart.getBoundingClientRect();
  if (!bounds.width) return;
  const chartX = (clientX - bounds.left) / bounds.width * 600;
  showHistoryInspection(UserView.findNearestUsagePoint(activeUsageChart.points, chartX));
}

function clearHistoryChart(message) {
  uploadLine.setAttribute('d', '');
  downloadLine.setAttribute('d', '');
  uploadDot.setAttribute('visibility', 'hidden');
  downloadDot.setAttribute('visibility', 'hidden');
  historyChartDescription.textContent = message;
  historyChartSummary.textContent = message;
  activeUsageChart = UserView.buildUsageChartModel([], selectedRange, 'UTC', 600, 240);
  renderHistoryAxes(activeUsageChart);
  hideHistoryInspection();
  updateHistoryChartContext([], selectedRange, 'UTC');
}

function updateHistoryChartContext(points, range, timezone) {
  const context = UserView.formatUsageChartContext(points, range, timezone);
  historyScaleLabel.textContent = context.scaleLabel;
  context.timeLabels.forEach((label, index) => { historyTimeLabels[index].textContent = label; });
  return context;
}

function renderHistory(history, profile, requestId) {
  if (requestId !== historyRequestId) return;
  const summary = setHistorySummary(history && history.summary);
  activeUsageTimezone = typeof history?.timezone === 'string' ? history.timezone : 'UTC';
  activeUsageChart = UserView.buildUsageChartModel(history && history.points, selectedRange, activeUsageTimezone, 600, 240);
  renderHistoryAxes(activeUsageChart);
  hideHistoryInspection();
  uploadLine.setAttribute('d', UserView.createUsagePath(activeUsageChart.points, 'uploadY'));
  downloadLine.setAttribute('d', UserView.createUsagePath(activeUsageChart.points, 'downloadY'));
  if (activeUsageChart.points.length === 1) {
    uploadDot.setAttribute('cx', String(activeUsageChart.points[0].x));
    uploadDot.setAttribute('cy', String(activeUsageChart.points[0].uploadY));
    downloadDot.setAttribute('cx', String(activeUsageChart.points[0].x));
    downloadDot.setAttribute('cy', String(activeUsageChart.points[0].downloadY));
    uploadDot.setAttribute('visibility', 'visible');
    downloadDot.setAttribute('visibility', 'visible');
  }
  const timezone = activeUsageTimezone;
  const rangeLabel = selectedRange === 'lifetime' ? 'Lifetime' : `Last ${selectedRange}`;
  const chartContext = updateHistoryChartContext(history && history.points, selectedRange, timezone);
  const label = `${profile.customerName || 'Customer'} · ${profile.codeName}, ${rangeLabel}. Total transferred ${summary.transferred}; peak upload ${summary.uploadPeak}; peak download ${summary.downloadPeak}; connected ${summary.connected}. Times shown in ${timezone}.`;
  historyState.textContent = activeUsageChart.points.length ? `Showing ${rangeLabel.toLowerCase()} usage · ${timezone}` : `No usage recorded for ${rangeLabel.toLowerCase()} · ${timezone}`;
  const chartContextDescription = `${chartContext.scaleLabel}. Time labels: ${chartContext.timeLabels.join(', ')}.`;
  historyChartDescription.textContent = activeUsageChart.points.length ? `${label} The chart shows upload and download speeds over time. ${chartContextDescription}` : `${label} No chart points are available for this range. ${chartContextDescription}`;
  historyChartSummary.textContent = activeUsageChart.points.length ? label : `No usage history for this range. ${label}`;
  historyError.hidden = true;
  historyErrorMessage.textContent = '';
}

async function loadHistory() {
  const profile = analyticsProfiles.find((item) => item.id === profileSelect.value);
  if (!profile) {
    historyRequestId += 1;
    if (historyController) historyController.abort();
    historyState.textContent = 'No eligible profiles are available for usage history.';
    setHistorySummary({});
    clearHistoryChart('No eligible profiles are available for usage history.');
    historyError.hidden = true;
    return;
  }
  const requestId = ++historyRequestId;
  if (historyController) historyController.abort();
  historyController = typeof AbortController === 'function' ? new AbortController() : null;
  const rangeLabel = selectedRange === 'lifetime' ? 'lifetime' : `last ${selectedRange}`;
  historyState.textContent = `Loading ${rangeLabel} usage…`;
  historyError.hidden = true;
  setHistorySummary({});
  clearHistoryChart('Usage history is loading.');
  document.querySelectorAll('[data-usage-range]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.usageRange === selectedRange)));
  try {
    const options = historyController ? { signal: historyController.signal } : {};
    const history = await api(`/api/storefront/analytics/${encodeURIComponent(profile.id)}?range=${encodeURIComponent(selectedRange)}`, options);
    if (requestId !== historyRequestId || profileSelect.value !== profile.id) return;
    renderHistory(history, profile, requestId);
  } catch (error) {
    if (requestId !== historyRequestId || error.name === 'AbortError') return;
    historyState.textContent = 'Usage history could not be loaded.';
    historyErrorMessage.textContent = error.message;
    historyError.hidden = false;
    clearHistoryChart('Usage history could not be loaded. Try again.');
  }
}

customerSelect.addEventListener('change', () => { renderProfileOptions(''); loadHistory(); });
profileSelect.addEventListener('change', loadHistory);
for (const button of document.querySelectorAll('[data-usage-range]')) {
  button.addEventListener('click', () => {
    if (!UserView.usageRanges.includes(button.dataset.usageRange)) return;
    selectedRange = button.dataset.usageRange;
    loadHistory();
  });
}
historyRetry.addEventListener('click', async () => {
  if (!analyticsProfiles.length) {
    const profiles = await loadAnalyticsProfiles();
    if (!profiles) return;
  }
  loadHistory();
});
usageChartHitArea.addEventListener('pointermove', (event) => inspectHistoryAtClientX(event.clientX));
usageChartHitArea.addEventListener('pointerdown', (event) => inspectHistoryAtClientX(event.clientX));
usageChartHitArea.addEventListener('pointerleave', hideHistoryInspection);
usageChart.addEventListener('blur', hideHistoryInspection);
usageChart.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !activeUsageChart.points.length) return;
  event.preventDefault();
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  activeUsagePointIndex = Math.max(0, Math.min(activeUsageChart.points.length - 1, activeUsagePointIndex < 0 ? 0 : activeUsagePointIndex + delta));
  showHistoryInspection(activeUsageChart.points[activeUsagePointIndex]);
});
customerRows.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-profile-id]');
  if (!button) return;
  const profile = analyticsProfiles.find((item) => item.id === button.dataset.profileId);
  if (!profile) return;
  setWorkspace('usage-history');
  customerSelect.value = profileCustomerKey(profile);
  renderProfileOptions(profile.id);
  loadHistory();
});

async function loadOrders() {
  ordersMessage.textContent = '';
  const refreshId = ++analyticsProfileRefreshId;
  try {
    const data = await api('/api/storefront/orders');
    if (refreshId === analyticsProfileRefreshId) renderAnalyticsProfiles(data.analyticsProfiles);
    ordersList.innerHTML = data.orders.length ? data.orders.map((order) => {
      const action = order.state === 'pending' ? 'approve' : (order.state === 'provisioning_failed' ? 'retry' : '');
      return `<article class="order-card"><div><h2>${escapeHtml(order.customer_name)} · ${escapeHtml(order.code_name)}</h2><div class="order-meta">${escapeHtml(order.customer_email)}<br>${escapeHtml(order.plan_name)} · ${order.months} month(s) · ¥${order.price_cny} · ${escapeHtml(order.payment_method)}</div><span class="state">${escapeHtml(order.state.replaceAll('_', ' '))}</span></div><div class="order-actions"><a class="ghost-link" target="_blank" rel="noopener" href="${adminUrl(`/api/storefront/orders/${encodeURIComponent(order.id)}/proof`)}">View proof</a>${action ? `<button data-order="${escapeHtml(order.id)}" data-action="${action}">${action === 'retry' ? 'Retry' : 'Approve'}</button>` : ''}${order.state === 'pending' ? `<button class="reject" data-order="${escapeHtml(order.id)}" data-action="reject">Reject</button>` : ''}</div></article>`;
    }).join('') : '<p class="muted">No storefront orders yet.</p>';
  } catch (error) { ordersMessage.textContent = error.message; }
}

document.getElementById('orders-btn').addEventListener('click', () => { ordersModal.classList.remove('hidden'); loadOrders(); });
document.getElementById('orders-close').addEventListener('click', () => ordersModal.classList.add('hidden'));
ordersList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-order]');
  if (!button) return;
  const action = button.dataset.action;
  let body;
  if (action === 'reject') {
    const reason = window.prompt('Reason for rejection (optional)');
    if (reason === null) return;
    body = JSON.stringify({ reason });
  } else if (!window.confirm(`${action === 'retry' ? 'Retry provisioning' : 'Approve payment and activate VPN'}?`)) return;
  button.disabled = true;
  try {
    const operation = () => api(`/api/storefront/orders/${encodeURIComponent(button.dataset.order)}/${action}`, { method: 'POST', body });
    if (action === 'approve' || action === 'retry') await UserView.afterSuccessfulProvisioning(operation, loadOrders);
    else { await operation(); await loadOrders(); }
  }
  catch (error) { ordersMessage.textContent = error.message; button.disabled = false; }
});

async function loadQrStatus() {
  qrMessage.textContent = '';
  try {
    const status = await api('/api/storefront/payment-qr');
    document.querySelectorAll('.qr-form').forEach((form) => {
      const current = status[form.dataset.method];
      form.querySelector('[data-role="status"]').textContent = current && current.available ? 'Current QR is active' : 'No QR uploaded yet';
    });
  } catch (error) { qrMessage.textContent = error.message; }
}

document.getElementById('payment-qr-btn').addEventListener('click', () => { qrModal.classList.remove('hidden'); loadQrStatus(); });
document.getElementById('payment-qr-close').addEventListener('click', () => qrModal.classList.add('hidden'));
document.querySelectorAll('.qr-form').forEach((form) => form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  qrMessage.textContent = '';
  try {
    const response = await fetch(adminUrl(`/api/storefront/payment-qr/${form.dataset.method}`), { method: 'POST', body: new FormData(form) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    form.reset();
    qrMessage.textContent = 'Payment QR updated.';
    await loadQrStatus();
  } catch (error) { qrMessage.textContent = error.message; }
  finally { button.disabled = false; }
}));

api('/api/session').then((s) => (s.authed ? showApp() : showLogin()));
