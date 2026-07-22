const { Router } = require('express');

const router = Router();

router.get('/fast', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Resposta rápida',
    timestamp: new Date().toISOString(),
    latency: '~1ms',
  });
});

router.get('/slow', async (req, res) => {
  const delay = Math.min(parseInt(req.query.delay, 10) || 500, 5000);
  await new Promise((r) => setTimeout(r, delay));
  res.json({
    status: 'ok',
    message: `Resposta com delay de ${delay}ms`,
    delay,
    timestamp: new Date().toISOString(),
  });
});

router.get('/cpu', (req, res) => {
  const iterations = Math.min(parseInt(req.query.iterations, 10) || 100_000, 1_000_000);
  let result = 0;
  for (let i = 0; i < iterations; i++) {
    result += Math.sqrt(i) * Math.sin(i);
  }
  res.json({
    status: 'ok',
    message: 'Processamento CPU-intensivo concluído',
    iterations,
    result: result.toFixed(4),
    timestamp: new Date().toISOString(),
  });
});

router.get('/large', (req, res) => {
  const size = Math.min(parseInt(req.query.size, 10) || 100, 1000);
  const data = Array.from({ length: size }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    value: Math.random() * 1000,
    tags: ['stress', 'test', 'load'],
    metadata: { created: new Date().toISOString(), index: i },
  }));
  res.json({ status: 'ok', count: data.length, data });
});

router.post('/echo', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Echo do payload recebido',
    received: req.body,
    headers: {
      contentType: req.get('content-type'),
      userAgent: req.get('user-agent'),
    },
    timestamp: new Date().toISOString(),
  });
});

router.get('/error', (req, res) => {
  const rate = Math.min(parseInt(req.query.rate, 10) || 50, 100);
  if (Math.random() * 100 < rate) {
    const codes = [400, 401, 403, 404, 429, 500, 502, 503];
    const code = codes[Math.floor(Math.random() * codes.length)];
    return res.status(code).json({
      status: 'error',
      message: `Erro simulado (${code})`,
      errorRate: rate,
      timestamp: new Date().toISOString(),
    });
  }
  res.json({
    status: 'ok',
    message: 'Requisição bem-sucedida (erro não disparado)',
    errorRate: rate,
    timestamp: new Date().toISOString(),
  });
});

router.get('/random', (_req, res) => {
  const behaviors = ['fast', 'slow', 'large', 'error'];
  const behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
  res.set('X-Stress-Behavior', behavior);
  res.json({
    status: 'ok',
    behavior,
    random: Math.random(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/health', (_req, res) => {
  // T22: versão quebrada falha readiness/liveness quando HEALTH_FAIL=true
  if (String(process.env.HEALTH_FAIL || '').toLowerCase() === 'true') {
    return res.status(503).json({
      status: 'unhealthy',
      version: process.env.APP_VERSION || 'unknown',
      message: 'HEALTH_FAIL=true (release intencionalmente quebrada)',
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    status: 'healthy',
    version: process.env.APP_VERSION || 'v1',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
