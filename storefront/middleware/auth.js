function requireCustomer(req, res, next) {
  if (!req.session || !req.session.customerId) {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' } });
  }
  return next();
}

module.exports = { requireCustomer };
