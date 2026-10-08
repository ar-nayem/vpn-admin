function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function shell(title, name, content, text) {
  const safeName = escapeHtml(name || 'there');
  return {
    html: `<!doctype html><html><body style="margin:0;background:#FFF8E7;color:#241B35;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:28px"><table role="presentation" width="100%" style="max-width:600px;background:#FFFFFF;border:3px solid #241B35;border-radius:18px"><tr><td style="background:#FACC15;padding:22px"><strong style="color:#6D28D9;font-size:24px">Bright Pocket VPN</strong></td></tr><tr><td style="padding:28px"><h1 style="color:#6D28D9">${escapeHtml(title)}</h1><p>Hello ${safeName},</p>${content}</td></tr></table></td></tr></table></body></html>`,
    text: `Bright Pocket VPN\n\n${title}\n\nHello ${name || 'there'},\n\n${text}`,
  };
}

function verificationEmail({ code, purpose }) {
  const title = purpose === 'password-reset' ? 'Reset your password' : 'Your verification code';
  const message = `Your six-digit code is ${code}. It expires in 10 minutes.`;
  return { subject: `${code} — Bright Pocket VPN verification`, ...shell(title, '', `<p>Your six-digit code is:</p><p style="font-size:34px;letter-spacing:8px"><strong>${escapeHtml(code)}</strong></p><p>It expires in 10 minutes.</p>`, message) };
}

function orderReceivedEmail({ name, planName, months, priceCny }) {
  const facts = `${planName} for ${months} month(s), ¥${priceCny}. Your payment proof is awaiting review.`;
  return { subject: 'We received your VPN request', ...shell('Payment proof received', name, `<p>${escapeHtml(facts)}</p>`, facts) };
}

function trialActivatedEmail({ name, codeName, downloadUrl }) {
  const facts = `Your one-time 1 GB trial for ${codeName} is active at 5 Mbps upload and download.`;
  return { subject: 'Your free VPN trial is ready', ...shell('Your trial is active', name, `<p>${escapeHtml(facts)}</p><p><a href="${escapeHtml(downloadUrl)}">Download configuration</a></p>`, `${facts}\nDownload: ${downloadUrl}`) };
}

function orderApprovedEmail({ name, codeName, planName, quotaGb, speedLabel, expiresAt, downloadUrl }) {
  const facts = `${planName} — ${quotaGb} GB — ${speedLabel} — expires ${expiresAt}. Code name: ${codeName}.`;
  return { subject: 'Your Bright Pocket VPN is ready', ...shell('VPN approved', name, `<p>${escapeHtml(facts)}</p><p><a href="${escapeHtml(downloadUrl)}">Download your VPN file</a></p>`, `${facts}\nDownload: ${downloadUrl}`) };
}

function orderRejectedEmail({ name, reason }) {
  const facts = `Your VPN request was not approved.${reason ? ` Reason: ${reason}` : ''}`;
  return { subject: 'Update about your VPN request', ...shell('Request not approved', name, `<p>${escapeHtml(facts)}</p>`, facts) };
}

function passwordRecoveryEmail(input) { return verificationEmail({ ...input, purpose: 'password-reset' }); }

module.exports = { escapeHtml, verificationEmail, orderReceivedEmail, trialActivatedEmail, orderApprovedEmail, orderRejectedEmail, passwordRecoveryEmail };
