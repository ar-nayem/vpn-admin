const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { PACKAGES } = require('./catalog');
const { SqliteSessionStore } = require('./session-store');
const { requireCustomer } = require('./middleware/auth');
const { issueCsrf, requireCsrf } = require('./middleware/csrf');
const { errorHandler } = require('./middleware/errors');

function createStorefrontApp({
  db, sessionSecret, production = false, services, uploadProof, publicDir = path.join(__dirname, 'public'),
}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"] } } }));
  app.use(express.json({ limit: '64kb' }));
  app.use(session({
    name: 'vpn_customer_sid', secret: sessionSecret, store: new SqliteSessionStore(db),
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 30 * 86400000 },
  }));
  const limiter = (max) => rateLimit({
    windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }),
  });

  app.get('/api/catalog', (req, res) => res.json({ packages: Object.entries(PACKAGES).map(([id, plan]) => ({ id, ...plan })) }));
  app.get('/api/session', (req, res) => res.json({ customerId: req.session.customerId || null, csrfToken: issueCsrf(req) }));
  app.post('/api/verification/request', limiter(5), (req, res, next) => {
    try { res.status(202).json(services.verification.requestCode(req.body)); } catch (error) { next(error); }
  });
  app.post('/api/verification/verify', limiter(10), (req, res, next) => {
    try { res.json(services.verification.verifyCode(req.body)); } catch (error) { next(error); }
  });
  app.post('/api/auth/register', limiter(10), (req, res, next) => {
    try { const customer = services.auth.register(req.body); req.session.customerId = customer.id; res.status(201).json({ customer, csrfToken: issueCsrf(req) }); } catch (error) { next(error); }
  });
  app.post('/api/auth/login/password', limiter(10), (req, res, next) => {
    try { const customer = services.auth.loginWithPassword(req.body); req.session.customerId = customer.id; res.json({ customer, csrfToken: issueCsrf(req) }); } catch (error) { next(error); }
  });
  app.post('/api/auth/login/code', limiter(10), (req, res, next) => {
    try { const customer = services.auth.loginWithCode(req.body); req.session.customerId = customer.id; res.json({ customer, csrfToken: issueCsrf(req) }); } catch (error) { next(error); }
  });
  app.post('/api/auth/password-reset', limiter(10), (req, res, next) => {
    try { res.json({ customer: services.auth.resetPassword(req.body) }); } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', requireCustomer, requireCsrf, (req, res, next) => req.session.destroy((error) => error ? next(error) : res.status(204).end()));

  app.post('/api/trials', limiter(3), (req, res, next) => services.trials.startTrial(req.body).then((profile) => res.status(201).json({ profile })).catch(next));
  app.post('/api/tracking', limiter(10), (req, res, next) => services.tracking.getGuestDashboard(req.body).then((dashboard) => res.json(dashboard)).catch(next));
  app.get('/api/dashboard', requireCustomer, (req, res, next) => services.tracking.getCustomerDashboard(req.session.customerId).then((dashboard) => res.json(dashboard)).catch(next));
  app.post('/api/profiles', requireCustomer, requireCsrf, (req, res, next) => {
    try { res.status(201).json({ profile: services.profiles.createPaidProfile(req.session.customerId, req.body.codeName) }); } catch (error) { next(error); }
  });

  app.post('/api/orders', requireCustomer, requireCsrf, limiter(10), uploadProof, (req, res, next) => {
    const input = { ...req.body, customerId: req.session.customerId, proof: req.file };
    services.orders.submitOrder(input).then((order) => res.status(201).json({ order })).catch(next);
  });
  app.post('/api/guest/orders', limiter(10), uploadProof, (req, res, next) => {
    try {
      const ownership = services.profiles.createGuestPaidProfile(req.body);
      services.orders.submitOrder({ ...req.body, customerId: ownership.customerId, profileId: ownership.profile.id, proof: req.file }).then((order) => res.status(201).json({ order })).catch(next);
    } catch (error) { next(error); }
  });
  app.get('/api/payment-qr/:method', (req, res, next) => {
    try {
      const qr = services.qr.getActiveQr(req.params.method);
      if (!qr.available) return res.status(404).json({ error: { code: 'QR_UNAVAILABLE', message: 'This payment method is unavailable.' } });
      return res.sendFile(qr.filename, { root: services.qrStoragePath, dotfiles: 'deny' }, next);
    } catch (error) { return next(error); }
  });
  app.get('/download/:token', (req, res, next) => {
    try {
      const file = services.downloads.redeemDownloadToken(req.params.token);
      res.set('Cache-Control', file.cacheControl);
      res.set('Content-Type', `${file.contentType}; charset=utf-8`);
      res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
      return res.send(file.content);
    } catch (error) { return next(error); }
  });

  if (publicDir) app.use(express.static(publicDir, { index: 'index.html', fallthrough: true }));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));
  app.use(errorHandler);
  return app;
}

module.exports = { createStorefrontApp };
