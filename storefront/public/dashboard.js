(async function () {
  let csrf;
  const profiles = document.querySelector('#profiles');
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
  try {
    const session = await (await fetch('/api/session')).json();
    if (!session.customerId) return location.href = '/auth.html';
    csrf = session.csrfToken;
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw (await response.json()).error;
    render((await response.json()).profiles);
  } catch (error) { profiles.innerHTML = `<p class="message error">${StorefrontModel.escapeHtml(StorefrontModel.safeError(error))}</p>`; }
  document.querySelector('#sign-out').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrf } });
    location.href = '/';
  });
}());
