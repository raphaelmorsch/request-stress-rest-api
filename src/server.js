const express = require('express');
const path = require('path');
const metricsMiddleware = require('./middleware/metrics');
const stressRoutes = require('./routes/stress');
const metricsRoutes = require('./routes/metrics');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(metricsMiddleware);

app.use('/api/stress', stressRoutes);
app.use('/api/metrics', metricsRoutes);

app.get('/api/endpoints', (_req, res) => {
  res.json({
    description: 'Endpoints disponíveis para testes de carga',
    tools: ['curl', 'ddosify', 'k6', 'wrk', 'ab'],
    endpoints: [
      { method: 'GET', path: '/api/stress/fast', description: 'Resposta rápida (~1ms)' },
      { method: 'GET', path: '/api/stress/slow?delay=500', description: 'Resposta lenta (delay configurável, max 5s)' },
      { method: 'GET', path: '/api/stress/cpu?iterations=100000', description: 'Processamento CPU-intensivo' },
      { method: 'GET', path: '/api/stress/large?size=100', description: 'Payload grande (até 1000 itens)' },
      { method: 'POST', path: '/api/stress/echo', description: 'Ecoa o body JSON recebido' },
      { method: 'GET', path: '/api/stress/error?rate=50', description: 'Erros aleatórios (taxa configurável %)' },
      { method: 'GET', path: '/api/stress/random', description: 'Comportamento aleatório' },
      { method: 'GET', path: '/api/stress/health', description: 'Health check' },
      { method: 'GET', path: '/api/metrics/snapshot', description: 'Snapshot das métricas' },
    ],
    examples: {
      curl: [
        'curl http://localhost:3000/api/stress/fast',
        'curl "http://localhost:3000/api/stress/slow?delay=1000"',
        'curl -X POST http://localhost:3000/api/stress/echo -H "Content-Type: application/json" -d \'{"test": true}\'',
      ],
      ddosify: [
        'ddosify -t http://localhost:3000/api/stress/fast -n 100 -c 10',
        'ddosify -t http://localhost:3000/api/stress/slow?delay=200 -n 50 -c 5',
        'ddosify -t http://localhost:3000/api/stress/random -n 200 -c 20 -d 30s',
      ],
    },
  });
});

app.use(
  '/patternfly',
  express.static(path.join(__dirname, '../node_modules/@patternfly/patternfly'))
);
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Stress Test API rodando em http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`📋 Endpoints: http://localhost:${PORT}/api/endpoints`);
});
