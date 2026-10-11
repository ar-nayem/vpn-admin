(function () {
  const message = document.querySelector('#auth-message');
  let active = new URLSearchParams(location.search).get('mode') || 'password';
  const forms = { password: document.querySelector('#password-form'), register: document.querySelector('#register-form'), trial: document.querySelector('#trial-form') };
  function show(tab) { active = forms[tab] ? tab : 'password'; Object.entries(forms).forEach(([name, form]) => form.classList.toggle('hidden', name !== active)); document.querySelectorAll('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === active))); message.textContent = ''; }
  async function api(url, body) { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw data.error; return data; }
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => show(button.dataset.tab)));
  forms.password.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/auth/login/password', Object.fromEntries(new FormData(event.target))); location.href = '/dashboard.html'; } catch (error) { message.className = 'message error'; message.textContent = StorefrontModel.safeError(error); } });
  forms.register.addEventListener('submit', async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); try { await api('/api/auth/register', { name: values.name, email: values.email, password: values.password }); location.href = '/dashboard.html'; } catch (error) { message.className = 'message error'; message.textContent = StorefrontModel.safeError(error); } event.target.elements.password.value = ''; });
  forms.trial.addEventListener('submit', async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); try { await api('/api/trials', { name: values.name, email: values.email, codeName: values.codeName }); message.className = 'message success'; message.textContent = 'Your trial is active. Check your email for the VPN file and secure link.'; event.target.reset(); } catch (error) { message.className = 'message error'; message.textContent = StorefrontModel.safeError(error); } });
  document.querySelector('#forgot').addEventListener('click', () => {
    Object.values(forms).forEach((form) => form.classList.add('hidden'));
    let recovery = document.querySelector('#recovery-form');
    if (!recovery) {
      recovery = document.createElement('form'); recovery.id = 'recovery-form'; recovery.className = 'form';
      recovery.innerHTML = '<h2>Reset password</h2><div class="field"><label for="recovery-email">Email</label><input id="recovery-email" name="email" type="email" required></div><button type="button" class="secondary" id="send-recovery">Send recovery code</button><div class="field"><label for="recovery-code">Six-digit code</label><input id="recovery-code" name="code" inputmode="numeric" maxlength="6" required></div><div class="field"><label for="recovery-password">New password</label><input id="recovery-password" name="password" type="password" minlength="10" required></div><button>Save new password</button>';
      message.before(recovery);
      recovery.querySelector('#send-recovery').addEventListener('click', async () => { try { await api('/api/verification/request', { email: recovery.email.value, purpose: 'password-reset' }); message.className = 'message success'; message.textContent = 'Recovery code sent.'; } catch (error) { message.className = 'message error'; message.textContent = StorefrontModel.safeError(error); } });
      recovery.addEventListener('submit', async (event) => { event.preventDefault(); try { const values = Object.fromEntries(new FormData(recovery)); const verified = await api('/api/verification/verify', { email: values.email, code: values.code, purpose: 'password-reset' }); await api('/api/auth/password-reset', { email: values.email, password: values.password, verificationGrant: verified.grant }); message.className = 'message success'; message.textContent = 'Password updated. You can sign in now.'; recovery.reset(); } catch (error) { message.className = 'message error'; message.textContent = StorefrontModel.safeError(error); } });
    } else recovery.classList.remove('hidden');
    message.textContent = '';
  });
  show(active);
}());
