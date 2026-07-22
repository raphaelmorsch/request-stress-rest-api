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
  const fallbackEnabled = Boolean(req.app.get('fallbackEnabled'));
  const fallbackUrl = req.app.get('fallbackUrl');

  const headers = { Accept: 'application/json' };
  const init = { method, headers };

  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  async function callUpstream(url) {
    const upstream = await fetch(url, init);
    const contentType = upstream.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await upstream.json()
      : await upstream.text();
    return { upstream, payload };
  }

  try {
    const { upstream, payload } = await callUpstream(targetUrl);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    if (upstream.ok || !fallbackEnabled || !fallbackUrl) {
      return res.status(upstream.status).json({
        status: upstream.ok ? 'ok' : 'error',
        client: 'request-stress-client',
        source: 'backend',
        backend: {
          url: targetUrl.toString(),
          method,
          statusCode: upstream.status,
          durationMs: Math.round(elapsedMs * 100) / 100,
        },
        data: payload,
      });
    }

    // T19: backend indisponível / 5xx → resposta degradada via fallback
    const fallbackTarget = buildTargetUrl(fallbackUrl, path, forwardQuery);
    try {
      const fb = await callUpstream(fallbackTarget);
      const totalMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      return res.status(200).json({
        status: 'degraded',
        client: 'request-stress-client',
        source: 'fallback',
        message: 'Backend indisponível; resposta degradada via fallback',
        backend: {
          url: targetUrl.toString(),
          method,
          statusCode: upstream.status,
          durationMs: Math.round(elapsedMs * 100) / 100,
        },
        fallback: {
          url: fallbackTarget.toString(),
          statusCode: fb.upstream.status,
          durationMs: Math.round(totalMs * 100) / 100,
        },
        data: fb.payload,
      });
    } catch (fallbackError) {
      return res.status(502).json({
        status: 'error',
        message: 'Backend e fallback indisponíveis',
        client: 'request-stress-client',
        backend: {
          url: targetUrl.toString(),
          method,
          statusCode: upstream.status,
          durationMs: Math.round(elapsedMs * 100) / 100,
        },
        error: fallbackError.message,
      });
    }
  } catch (error) {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    if (fallbackEnabled && fallbackUrl) {
      const fallbackTarget = buildTargetUrl(fallbackUrl, path, forwardQuery);
      try {
        const fb = await callUpstream(fallbackTarget);
        const totalMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        return res.status(200).json({
          status: 'degraded',
          client: 'request-stress-client',
          source: 'fallback',
          message: 'Falha de rede no backend; resposta degradada via fallback',
          backend: {
            url: targetUrl.toString(),
            method,
            durationMs: Math.round(elapsedMs * 100) / 100,
            error: error.message,
          },
          fallback: {
            url: fallbackTarget.toString(),
            statusCode: fb.upstream.status,
            durationMs: Math.round(totalMs * 100) / 100,
          },
          data: fb.payload,
        });
      } catch (fallbackError) {
        return res.status(502).json({
          status: 'error',
          message: 'Falha ao chamar backend e fallback',
          client: 'request-stress-client',
          backend: {
            url: targetUrl.toString(),
            method,
            durationMs: Math.round(elapsedMs * 100) / 100,
          },
          error: `${error.message}; fallback: ${fallbackError.message}`,
        });
      }
    }

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
