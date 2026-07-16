const { Router } = require('express');

const router = Router();

function buildTargetUrl(backendUrl, path, query = {}) {
  const url = new URL(path, backendUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * Proxy único para o backend.
 *
 * GET /api/call?path=/api/stress/fast
 * GET /api/call?path=/api/stress/slow&delay=500
 * GET /api/call?path=/api/stress/echo&method=POST  (body JSON opcional via ?body=)
 */
router.all('/', async (req, res) => {
  const backendUrl = req.app.get('backendUrl');
  const path = req.query.path;

  if (!path || typeof path !== 'string' || !path.startsWith('/')) {
    return res.status(400).json({
      status: 'error',
      message: 'Parâmetro "path" é obrigatório e deve começar com /',
      example: '/api/call?path=/api/stress/fast',
    });
  }

  const method = String(req.query.method || req.method || 'GET').toUpperCase();
  const forwardQuery = { ...req.query };
  delete forwardQuery.path;
  delete forwardQuery.method;
  delete forwardQuery.body;

  let body;
  if (req.query.body) {
    try {
      body = JSON.parse(String(req.query.body));
    } catch {
      return res.status(400).json({ status: 'error', message: 'Parâmetro "body" deve ser JSON válido' });
    }
  } else if (req.body && Object.keys(req.body).length > 0) {
    body = req.body;
  }

  const targetUrl = buildTargetUrl(backendUrl, path, forwardQuery);
  const started = process.hrtime.bigint();

  try {
    const headers = { Accept: 'application/json' };
    const init = { method, headers };

    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const upstream = await fetch(targetUrl, init);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const contentType = upstream.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await upstream.json()
      : await upstream.text();

    res.status(upstream.status).json({
      status: upstream.ok ? 'ok' : 'error',
      client: 'request-stress-client',
      backend: {
        url: targetUrl.toString(),
        method,
        statusCode: upstream.status,
        durationMs: Math.round(elapsedMs * 100) / 100,
      },
      data: payload,
    });
  } catch (error) {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    res.status(502).json({
      status: 'error',
      message: 'Falha ao chamar o backend',
      client: 'request-stress-client',
      backend: {
        url: targetUrl.toString(),
        method,
        durationMs: Math.round(elapsedMs * 100) / 100,
      },
      error: error.message,
    });
  }
});

module.exports = router;
