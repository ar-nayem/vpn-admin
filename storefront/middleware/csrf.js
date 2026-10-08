const crypto = require('crypto');

function issueCsrf(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const expected = req.session && req.session.csrfToken;
  const supplied = req.get('x-csrf-token');
  if (!expected || !supplied || expected.length !== supplied.length
    || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'Please refresh the page and try again.' } });
  }
  return next();
}

module.exports = { issueCsrf, requireCsrf };
