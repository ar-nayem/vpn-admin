const crypto = require('crypto');

function bodyDigest(body) {
  return crypto.createHash('sha256').update(body || '').digest('hex');
}

function canonicalRequest({ timestamp, nonce, method, path, body }) {
  return `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyDigest(body)}`;
}

function signInternalRequest({ secret, timestamp, nonce, method, path, body }) {
  return crypto.createHmac('sha256', secret)
    .update(canonicalRequest({ timestamp, nonce, method, path, body }))
    .digest('hex');
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function createInternalAuth({ secret, now = () => new Date(), maxSkewSeconds = 60 }) {
  if (!secret) throw new TypeError('internal shared secret is required');
  const nonces = new Map();

  return function requireInternalAuth(req, res, next) {
    const currentSeconds = Math.floor(now().getTime() / 1000);
    for (const [nonce, expires] of nonces) {
      if (expires <= currentSeconds) nonces.delete(nonce);
    }
    const timestamp = req.get('x-storefront-timestamp') || '';
    const nonce = req.get('x-storefront-nonce') || '';
    const supplied = req.get('x-storefront-signature') || '';
    const parsedTimestamp = Number(timestamp);
    if (
      !isLoopback(req.socket.remoteAddress)
      || !Number.isInteger(parsedTimestamp)
      || Math.abs(currentSeconds - parsedTimestamp) > maxSkewSeconds
      || !nonce
      || nonces.has(nonce)
      || !/^[a-f0-9]{64}$/.test(supplied)
    ) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const expected = signInternalRequest({
      secret,
      timestamp,
      nonce,
      method: req.method,
      path: req.path,
      body: req.rawBody ? req.rawBody.toString('utf8') : '',
    });
    if (!crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    nonces.set(nonce, currentSeconds + 300);
    return next();
  };
}

module.exports = { canonicalRequest, signInternalRequest, createInternalAuth };
