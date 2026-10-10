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
  const chart = document.querySelector('#usage-chart');
  const chartGrid = document.querySelector('#usage-grid');
  const chartYAxis = document.querySelector('#usage-y-axis');
  const chartXAxis = document.querySelector('#usage-x-axis');
  const chartCrosshair = document.querySelector('#usage-crosshair');
  const chartHitArea = document.querySelector('#usage-hit-area');
  const chartTooltip = document.querySelector('#usage-tooltip');
  const uploadFocus = document.querySelector('#usage-upload-focus');
  const downloadFocus = document.querySelector('#usage-download-focus');
  let selectedRange = '1d';
  let requestId = 0;
  let activeController;
  let activeChartModel = { points: [] };
  let activeTimezone = 'UTC';
  let activePointIndex = -1;
  const svgNamespace = 'http://www.w3.org/2000/svg';

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

  function svgNode(name, attributes, text) {
    const node = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderAxes(model) {
    chartGrid.replaceChildren();
    chartYAxis.replaceChildren();
    chartXAxis.replaceChildren();
    for (const tick of model.yTicks) {
      chartGrid.append(svgNode('line', { x1: model.bounds.left, x2: model.bounds.right, y1: tick.y, y2: tick.y }));
      chartYAxis.append(svgNode('text', { x: model.bounds.left - 9, y: tick.y + 4, 'text-anchor': 'end' }, tick.label));
    }
    model.xTicks.forEach((tick, index) => {
      chartGrid.append(svgNode('line', { class: 'vertical', x1: tick.x, x2: tick.x, y1: model.bounds.top, y2: model.bounds.bottom }));
      const anchor = index === 0 ? 'start' : index === model.xTicks.length - 1 ? 'end' : 'middle';
      chartXAxis.append(svgNode('text', { x: tick.x, y: 230, 'text-anchor': anchor }, tick.label));
    });
  }

  function hideInspection() {
    activePointIndex = -1;
    chartCrosshair.setAttribute('visibility', 'hidden');
    uploadFocus.setAttribute('visibility', 'hidden');
    downloadFocus.setAttribute('visibility', 'hidden');
    chartTooltip.hidden = true;
  }

  function pointTimeLabel(point) {
    const options = { dateStyle: 'medium', timeStyle: 'short', timeZone: activeTimezone };
    try { return new Intl.DateTimeFormat('en-GB', options).format(new Date(point.timestamp)); }
    catch { return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(point.timestamp)); }
  }

  function pointSpeedLabel(value) {
    return value >= 1024 ? `${Number((value / 1024).toFixed(2))} Mbps` : `${Math.round(value)} Kbps`;
  }

  function showInspection(point) {
    if (!point) return hideInspection();
    activePointIndex = activeChartModel.points.indexOf(point);
    chartCrosshair.setAttribute('x1', String(point.x));
    chartCrosshair.setAttribute('x2', String(point.x));
    chartCrosshair.setAttribute('visibility', 'visible');
    for (const [node, y] of [[uploadFocus, point.uploadY], [downloadFocus, point.downloadY]]) {
      node.setAttribute('cx', String(point.x));
      node.setAttribute('cy', String(y));
      node.setAttribute('visibility', 'visible');
    }
    chartTooltip.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: pointTimeLabel(point) }),
      Object.assign(document.createElement('span'), { textContent: `Upload ${pointSpeedLabel(point.uploadKbps)}` }),
      Object.assign(document.createElement('span'), { textContent: `Download ${pointSpeedLabel(point.downloadKbps)}` }),
    );
    chartTooltip.style.left = `${Math.max(18, Math.min(82, point.x / 6))}%`;
    chartTooltip.hidden = false;
  }

  function inspectAtClientX(clientX) {
    const bounds = chart.getBoundingClientRect();
    if (!bounds.width) return;
    const chartX = (clientX - bounds.left) / bounds.width * 600;
    showInspection(StorefrontModel.findNearestUsagePoint(activeChartModel.points, chartX));
  }

  function clearChart(message) {
    uploadLine.setAttribute('d', '');
    downloadLine.setAttribute('d', '');
    uploadDot.setAttribute('visibility', 'hidden');
    downloadDot.setAttribute('visibility', 'hidden');
    chartDescription.textContent = message;
    chartSummary.textContent = message;
    activeChartModel = StorefrontModel.buildUsageChartModel([], selectedRange, 'UTC', 600, 240);
    renderAxes(activeChartModel);
    hideInspection();
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
    activeTimezone = history && typeof history.timezone === 'string' ? history.timezone : 'UTC';
    activeChartModel = StorefrontModel.buildUsageChartModel(history && history.points, range, activeTimezone, 600, 240);
    renderAxes(activeChartModel);
    hideInspection();
    uploadLine.setAttribute('d', StorefrontModel.createUsagePath(activeChartModel.points, 'uploadY'));
    downloadLine.setAttribute('d', StorefrontModel.createUsagePath(activeChartModel.points, 'downloadY'));
    if (activeChartModel.points.length === 1) {
      uploadDot.setAttribute('cx', String(activeChartModel.points[0].x));
      uploadDot.setAttribute('cy', String(activeChartModel.points[0].uploadY));
      downloadDot.setAttribute('cx', String(activeChartModel.points[0].x));
      downloadDot.setAttribute('cy', String(activeChartModel.points[0].downloadY));
      uploadDot.setAttribute('visibility', 'visible');
      downloadDot.setAttribute('visibility', 'visible');
    } else {
      uploadDot.setAttribute('visibility', 'hidden');
      downloadDot.setAttribute('visibility', 'hidden');
    }

    const timezone = activeTimezone;
    const rangeLabel = range === 'lifetime' ? 'Lifetime' : `Last ${range}`;
    const chartContext = updateChartContext(history && history.points, range, timezone);
    const detail = `${profileName}, ${rangeLabel}. Total transferred ${formatted.transferred}; peak upload ${formatted.uploadPeak}; peak download ${formatted.downloadPeak}; connected ${formatted.connected}. Times shown in ${timezone}.`;
    state.textContent = activeChartModel.points.length ? `Showing ${rangeLabel.toLowerCase()} usage · ${timezone}` : `No usage recorded for ${rangeLabel.toLowerCase()} · ${timezone}`;
    const chartContextDescription = `${chartContext.scaleLabel}. Time labels: ${chartContext.timeLabels.join(', ')}.`;
    chartDescription.textContent = activeChartModel.points.length
      ? `${detail} The chart shows upload and download speeds over time. ${chartContextDescription}`
      : `${detail} No chart points are available for this range. ${chartContextDescription}`;
    chartSummary.textContent = activeChartModel.points.length
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
  chartHitArea.addEventListener('pointermove', (event) => inspectAtClientX(event.clientX));
  chartHitArea.addEventListener('pointerdown', (event) => inspectAtClientX(event.clientX));
  chartHitArea.addEventListener('pointerleave', hideInspection);
  chart.addEventListener('blur', hideInspection);
  chart.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !activeChartModel.points.length) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    activePointIndex = Math.max(0, Math.min(activeChartModel.points.length - 1, activePointIndex < 0 ? 0 : activePointIndex + delta));
    showInspection(activeChartModel.points[activePointIndex]);
  });

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
