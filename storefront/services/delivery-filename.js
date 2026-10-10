const crypto = require('node:crypto');

function sanitizeLabel(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}/\\]/gu, '')
    .trim()
    .replace(/(?:\.conf)+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function buildDeliveryFilename({ name, email, codeName, profileId, profileSuffix = '' }) {
  const customer = sanitizeLabel(name) || sanitizeLabel(String(email ?? '').split('@')[0]);
  const device = sanitizeLabel(codeName);
  const fallback = `vpn-${sanitizeLabel(profileId).slice(0, 8)}`;
  const suffix = sanitizeLabel(profileSuffix);
  const deviceTail = [device, suffix].filter(Boolean).join('-');
  const tail = deviceTail ? `-${deviceTail}` : '';
  const availableCustomerLength = Math.max(0, 96 - Array.from(tail).length);
  const customerPrefix = Array.from(customer).slice(0, availableCustomerLength).join('').replace(/-+$/, '');
  const basename = deviceTail
    ? `${customerPrefix}${customerPrefix ? '-' : ''}${deviceTail}`
    : customerPrefix || fallback;
  const cappedBasename = Array.from(basename).slice(0, 96).join('').replace(/-+$/, '');
  return `${cappedBasename}.conf`;
}

function buildUniqueDeliveryFilename({ profiles, customerId, ...labels }) {
  const filename = buildDeliveryFilename(labels);
  if (!profiles.findByCustomerAndDeliveryFilename(customerId, filename)) return filename;

  const digest = crypto.createHash('sha256').update(String(labels.profileId)).digest('hex');
  for (let length = 8; length <= digest.length; length += 2) {
    const candidate = buildDeliveryFilename({ ...labels, profileSuffix: digest.slice(0, length) });
    if (!profiles.findByCustomerAndDeliveryFilename(customerId, candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique delivery filename');
}

module.exports = { buildDeliveryFilename, buildUniqueDeliveryFilename };
