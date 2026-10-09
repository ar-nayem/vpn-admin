function sanitizeLabel(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}/\\]/gu, '')
    .trim()
    .replace(/(?:\.conf)+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function buildDeliveryFilename({ name, email, codeName, profileId }) {
  const customer = sanitizeLabel(name) || sanitizeLabel(String(email ?? '').split('@')[0]);
  const device = sanitizeLabel(codeName);
  const labels = [customer, device].filter(Boolean);
  const basename = labels.length
    ? labels.join('-')
    : `vpn-${sanitizeLabel(profileId).slice(0, 8)}`;
  const cappedBasename = Array.from(basename).slice(0, 96).join('').replace(/-+$/, '');
  return `${cappedBasename}.conf`;
}

module.exports = { buildDeliveryFilename };
