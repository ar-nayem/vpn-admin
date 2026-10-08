function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const explicitStatus = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : null;
  const status = explicitStatus || (error instanceof TypeError || error.code ? 400 : 500);
  const code = status >= 500 ? 'SERVICE_UNAVAILABLE' : (error.code || 'INVALID_REQUEST');
  const message = status >= 500 ? 'The service is temporarily unavailable.' : (error.message || 'The request is invalid.');
  return res.status(status).json({ error: { code, message } });
}

module.exports = { errorHandler };
