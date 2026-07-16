const { Router } = require('express');
const { BACKEND_ENDPOINTS } = require('../endpoints');

const router = Router();

async function callBackend(backendUrl, { method, path, query, body }) {
  const url = new URL(path, backendUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const started = process.hrtime.bigint();
  const headers = { Accept: 'application/json' };
  const init = { method, headers };

  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const upstream = await fetch(url, init);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      await upstream.json().catch(() => null);
    } else {
      await upstream.text().catch(() => null);
    }

    return {
      ok: upstream.ok,
      statusCode: upstream.status,
      durationMs: Math.round(elapsedMs * 100) / 100,
      error: null,
    };
  } catch (error) {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      ok: false,
      statusCode: 0,
      durationMs: Math.round(elapsedMs * 100) / 100,
      error: error.message,
    };
  }
}

async function runPool(total, concurrency, worker) {
  const results = new Array(total);
  let next = 0;

  async function runWorker() {
    while (next < total) {
      const index = next++;
      results[index] = await worker(index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

/**
 * Dispara carga contra o backend (via HTTP direto, mesmo caminho do /api/call).
 * POST /api/load
 * {
 *   "endpointId": "fast",
 *   "requests": 100,
 *   "concurrency": 10,
 *   "query": { "delay": "200" },
 *   "body": { ... }
 * }
 */
router.post('/', async (req, res) => {
  const backendUrl = req.app.get('backendUrl');
  const {
    endpointId,
    path,
    method,
    requests = 50,
    concurrency = 5,
    query = {},
    body,
  } = req.body || {};

  const total = Math.min(Math.max(parseInt(requests, 10) || 50, 1), 5000);
  const conc = Math.min(Math.max(parseInt(concurrency, 10) || 5, 1), 200);

  let target = null;
  if (endpointId) {
    target = BACKEND_ENDPOINTS.find((e) => e.id === endpointId);
  }

  const resolvedMethod = String(method || target?.method || 'GET').toUpperCase();
  const resolvedPath = path || target?.path;
  const resolvedBody = body !== undefined ? body : target?.body;
  const resolvedQuery = { ...(target?.params
    ? Object.fromEntries(target.params.map((p) => [p.name, p.default]))
    : {}), ...query };

  if (!resolvedPath) {
    return res.status(400).json({
      status: 'error',
      message: 'Informe endpointId ou path',
    });
  }

  const startedAt = Date.now();
  const results = await runPool(total, conc, () =>
    callBackend(backendUrl, {
      method: resolvedMethod,
      path: resolvedPath,
      query: resolvedQuery,
      body: resolvedBody,
    })
  );
  const elapsedMs = Date.now() - startedAt;

  const success = results.filter((r) => r.ok).length;
  const failed = results.length - success;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
  const p = (pct) => durations[Math.max(0, Math.ceil((pct / 100) * durations.length) - 1)] || 0;

  const statusCodes = {};
  for (const r of results) {
    const key = String(r.statusCode || 'network_error');
    statusCodes[key] = (statusCodes[key] || 0) + 1;
  }

  res.json({
    status: 'ok',
    client: 'request-stress-client',
    target: {
      method: resolvedMethod,
      path: resolvedPath,
      url: new URL(resolvedPath, backendUrl).toString(),
      query: resolvedQuery,
    },
    config: { requests: total, concurrency: conc },
    summary: {
      success,
      failed,
      successRate: ((success / total) * 100).toFixed(2),
      elapsedMs,
      rps: Number((total / (elapsedMs / 1000)).toFixed(1)),
      latency: {
        avg: Math.round(avg),
        min: Math.round(durations[0] || 0),
        max: Math.round(durations[durations.length - 1] || 0),
        p50: Math.round(p(50)),
        p95: Math.round(p(95)),
        p99: Math.round(p(99)),
      },
      statusCodes,
    },
  });
});

module.exports = router;
