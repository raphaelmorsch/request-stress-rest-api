const metrics = require('../metrics/collector');

function metricsMiddleware(req, res, next) {
  if (req.path.startsWith('/api/metrics/stream')) return next();

  const start = process.hrtime.bigint();
  metrics.connectionOpened();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    metrics.recordRequest({
      method: req.method,
      path: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip,
    });
    metrics.connectionClosed();
  });

  next();
}

module.exports = metricsMiddleware;
