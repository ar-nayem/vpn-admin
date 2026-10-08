const http = require('http');
const crypto = require('crypto');
const { signInternalRequest } = require('../../lib/internal-auth');

function createProvisioningClient({ secret, host = '127.0.0.1', port = 7500, timeoutMs = 5000, now = () => new Date(), randomUUID = crypto.randomUUID }) {
  if (!secret) throw new TypeError('internal shared secret is required');

  function request(method, requestPath, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const nonce = randomUUID();
    const signature = signInternalRequest({ secret, timestamp, nonce, method, path: requestPath, body });
    return new Promise((resolve, reject) => {
      const req = http.request({
        host, port, method, path: requestPath,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-storefront-timestamp': timestamp,
          'x-storefront-nonce': nonce,
          'x-storefront-signature': signature,
        },
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return reject(new Error('provisioning service returned an invalid response')); }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error('provisioning service rejected the request');
            error.status = res.statusCode;
            error.code = parsed.code || 'PROVISIONING_REJECTED';
            return reject(error);
          }
          return resolve(parsed);
        });
      });
      req.on('timeout', () => req.destroy(new Error('provisioning service timed out')));
      req.on('error', reject);
      req.end(body);
    });
  }

  return {
    createTrial(input) { return request('POST', '/internal/v1/profiles/trial', input); },
    createPaid(input) { return request('POST', '/internal/v1/profiles/paid', input); },
    upgrade(deviceId, input) { return request('POST', `/internal/v1/profiles/${encodeURIComponent(deviceId)}/upgrade`, input); },
    getStatus(deviceId) { return request('GET', `/internal/v1/profiles/${encodeURIComponent(deviceId)}/status`); },
  };
}

module.exports = { createProvisioningClient };
