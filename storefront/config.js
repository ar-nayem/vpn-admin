const path = require('path');

function key(value, name) {
  if (!value) throw new Error(`${name} is required`);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key`);
  return decoded;
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const required = (name) => {
    if (!env[name]) throw new Error(`${name} is required`);
    return env[name];
  };
  return {
    production,
    host: '127.0.0.1',
    port: Number(env.STOREFRONT_PORT || 7600),
    sessionSecret: required('STOREFRONT_SESSION_SECRET'),
    otpPepper: required('OTP_PEPPER'),
    outboxKey: key(required('OUTBOX_KEY'), 'OUTBOX_KEY'),
    downloadKey: key(required('DOWNLOAD_KEY'), 'DOWNLOAD_KEY'),
    internalSecret: required('INTERNAL_SHARED_SECRET'),
    gmailAppPassword: production ? required('GMAIL_APP_PASSWORD') : env.GMAIL_APP_PASSWORD,
    databasePath: env.STOREFRONT_DATABASE_PATH || path.resolve('private/storefront.db'),
    storagePath: env.STOREFRONT_STORAGE_PATH || path.resolve('private/storefront'),
  };
}

module.exports = { loadConfig };
