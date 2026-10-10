(async function () {
  let csrf;
  const profiles = document.querySelector('#profiles');
  const historyPanel = document.querySelector('#usage-history');
  const profileSelect = document.querySelector('#usage-profile-select');
  const rangeButtons = [...document.querySelectorAll('[data-usage-range]')];
  const state = document.querySelector('#usage-state');
  const errorPanel = document.querySelector('#usage-error');
  const errorMessage = document.querySelector('#usage-error-message');
  const retryButton = document.querySelector('#usage-retry');
  const chartDescription = document.querySelector('#usage-chart-description');
  const chartSummary = document.querySelector('#usage-chart-summary');
  const scaleLabel = document.querySelector('#usage-scale-label');
  const timeLabels = [
    document.querySelector('#usage-time-start'),
    document.querySelector('#usage-time-middle'),
    document.querySelector('#usage-time-end'),
  ];
  const uploadLine = document.querySelector('#usage-upload-line');
  const downloadLine = document.querySelector('#usage-download-line');
  const uploadDot = document.querySelector('#usage-upload-dot');
  const downloadDot = document.querySelector('#usage-download-dot');
  let selectedRange = '1d';
  let requestId = 0;
  let activeController;

  function render(items) {
    if (!items.length) {
      profiles.innerHTML = '<div class="panel empty"><h2>No device profiles yet</h2><p>Start the free trial or add a paid device.</p><a class="button" href="/auth.html?mode=trial">Start free</a></div>';
      return;
    }
    profiles.innerHTML = items.map((raw) => {
      const p = StorefrontModel.profileView(raw);
      const codeName = StorefrontModel.escapeHtml(p.codeName);
      const planName = StorefrontModel.escapeHtml(p.planName || 'VPN profile');
      const status = StorefrontModel.escapeHtml(p.exhausted ? 'Data used' : p.status);
      return `<article class="profile"><div class="profile-head"><div><h2>${codeName}</h2><span>${planName}</span></div><span class="badge">${status}</span></div><p><strong>${p.remainingLabel}</strong> remaining of ${p.totalLabel}</p><div class="meter" role="progressbar" aria-label="Data remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percentRemaining}"><span style="width:${p.percentRemaining}%"></span></div><dl><div><dt>Used</dt><dd>${p.usedLabel}</dd></div><div><dt>Speed</dt><dd>${p.speedLabel}</dd></div><div><dt>Expiry</dt><dd>${p.expiryLabel}</dd></div><div><dt>Status</dt><dd>${p.exhausted ? 'Quota exhausted' : status}</dd></div></dl><a class="button" href="/checkout.html?profile=${encodeURIComponent(p.id)}">${p.action} plan</a></article>`;
    }).join('');
  }

  function currentSelection() {
    return { profileId: profileSelect.value, range: selectedRange };
  }

  function setRangeButtons() {
    for (const button of rangeButtons) button.setAttribute('aria-pressed', String(button.dataset.usageRange === selectedRange));
  }

  function clearChart(message) {
    uploadLine.setAttribute('d', '');
    downloadLine.setAttribute('d', '');
    uploadDot.setAttribute('visibility', 'hidden');
    downloadDot.setAttribute('visibility', 'hidden');
    chartDescription.textContent = message;
    chartSummary.textContent = message;
    updateChartContext([], selectedRange, 'UTC');
  }

  function updateChartContext(points, range, timezone) {
    const context = StorefrontModel.formatUsageChartContext(points, range, timezone);
    scaleLabel.textContent = context.scaleLabel;
    context.timeLabels.forEach((label, index) => { timeLabels[index].textContent = label; });
    return context;
  }

  function setSummary(summary) {
    const formatted = StorefrontModel.formatUsageSummary(summary);
    document.querySelector('#usage-transferred').textContent = formatted.transferred;
    document.querySelector('#usage-upload-peak').textContent = formatted.uploadPeak;
    document.querySelector('#usage-download-peak').textContent = formatted.downloadPeak;
    document.querySelector('#usage-connected').textContent = formatted.connected;
    return formatted;
  }

  function renderHistory(history, range, profileName, id) {
    if (requestId !== id) return;
    const formatted = setSummary(history && history.summary);
    const normalized = StorefrontModel.normalizeUsagePoints(history && history.points, 600, 180);
    uploadLine.setAttribute('d', StorefrontModel.createUsagePath(normalized.points, 'uploadY'));
    downloadLine.setAttribute('d', StorefrontModel.createUsagePath(normalized.points, 'downloadY'));
    if (normalized.points.length === 1) {
      uploadDot.setAttribute('cx', String(normalized.points[0].x));
      uploadDot.setAttribute('cy', String(normalized.points[0].uploadY));
      downloadDot.setAttribute('cx', String(normalized.points[0].x));
      downloadDot.setAttribute('cy', String(normalized.points[0].downloadY));
      uploadDot.setAttribute('visibility', 'visible');
      downloadDot.setAttribute('visibility', 'visible');
    } else {
      uploadDot.setAttribute('visibility', 'hidden');
      downloadDot.setAttribute('visibility', 'hidden');
    }

    const timezone = history && typeof history.timezone === 'string' ? history.timezone : 'UTC';
    const rangeLabel = range === 'lifetime' ? 'Lifetime' : `Last ${range}`;
    const chartContext = updateChartContext(history && history.points, range, timezone);
    const detail = `${profileName}, ${rangeLabel}. Total transferred ${formatted.transferred}; peak upload ${formatted.uploadPeak}; peak download ${formatted.downloadPeak}; connected ${formatted.connected}. Times shown in ${timezone}.`;
    state.textContent = normalized.points.length ? `Showing ${rangeLabel.toLowerCase()} usage · ${timezone}` : `No usage recorded for ${rangeLabel.toLowerCase()} · ${timezone}`;
    const chartContextDescription = `${chartContext.scaleLabel}. Time labels: ${chartContext.timeLabels.join(', ')}.`;
    chartDescription.textContent = normalized.points.length
      ? `${detail} The chart shows upload and download speeds over time. ${chartContextDescription}`
      : `${detail} No chart points are available for this range. ${chartContextDescription}`;
    chartSummary.textContent = normalized.points.length
      ? detail
      : `No usage history for this range. ${detail}`;
    errorPanel.hidden = true;
    errorMessage.textContent = '';
  }

  async function loadHistory() {
    const { profileId, range } = currentSelection();
    if (!profileId || !StorefrontModel.isUsageRange(range)) return;
    const profile = historyPanelProfiles.find((item) => item.id === profileId);
    if (!profile || profile.analyticsEnabled !== true) return;

    const id = ++requestId;
    if (activeController) activeController.abort();
    activeController = typeof AbortController === 'function' ? new AbortController() : null;
    state.textContent = `Loading ${range === 'lifetime' ? 'lifetime' : `last ${range}`} usage…`;
    errorPanel.hidden = true;
    setSummary({});
    clearChart('Usage history is loading.');
    const options = activeController ? { signal: activeController.signal } : {};
    try {
      const response = await fetch(`/api/analytics/${encodeURIComponent(profileId)}?range=${encodeURIComponent(range)}`, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw body.error || new Error('Usage history could not be loaded.');
      const latest = currentSelection();
      if (id !== requestId || latest.profileId !== profileId || latest.range !== range) return;
      renderHistory(body, range, profile.codeName, id);
    } catch (error) {
      if (id !== requestId || (error && error.name === 'AbortError')) return;
      state.textContent = 'Usage history could not be loaded.';
      errorMessage.textContent = StorefrontModel.safeError(error);
      errorPanel.hidden = false;
      clearChart('Usage history could not be loaded. Try again.');
    }
  }

  let historyPanelProfiles = [];
  function setupHistory(items) {
    historyPanelProfiles = items.filter((item) => item.analyticsEnabled === true);
    if (!historyPanelProfiles.length) {
      const pending = items.some((item) => item.analyticsPending === true);
      if (pending) {
        historyPanel.hidden = false;
        profileSelect.disabled = true;
        state.textContent = 'Usage history will be available after this device is activated.';
        setSummary({});
        clearChart('Usage history is waiting for device activation.');
        return;
      }
      historyPanel.hidden = true;
      return;
    }
    profileSelect.disabled = false;
    profileSelect.innerHTML = historyPanelProfiles.map((profile) =>
      `<option value="${StorefrontModel.escapeHtml(profile.id)}">${StorefrontModel.escapeHtml(profile.codeName)}</option>`).join('');
    historyPanel.hidden = false;
    profileSelect.value = historyPanelProfiles[0].id;
    selectedRange = '1d';
    setRangeButtons();
    loadHistory();
  }

  profileSelect.addEventListener('change', loadHistory);
  for (const button of rangeButtons) {
    button.addEventListener('click', () => {
      if (!StorefrontModel.isUsageRange(button.dataset.usageRange)) return;
      selectedRange = button.dataset.usageRange;
      setRangeButtons();
      loadHistory();
    });
  }
  retryButton.addEventListener('click', loadHistory);

  try {
    const session = await (await fetch('/api/session')).json();
    if (!session.customerId) return location.href = '/auth.html';
    csrf = session.csrfToken;
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw (await response.json()).error;
    const items = (await response.json()).profiles;
    render(items);
    setupHistory(items);
  } catch (error) {
    profiles.innerHTML = `<p class="message error">${StorefrontModel.escapeHtml(StorefrontModel.safeError(error))}</p>`;
  }
  document.querySelector('#sign-out').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrf } });
    location.href = '/';
  });
}());
