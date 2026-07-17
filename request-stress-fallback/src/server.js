const express = require('express');

const app = express();
const PORT = process.env.PORT || 5001;

const degradedResponse = () => ({
  status: 'degraded',
  message: 'Serviço principal temporariamente indisponível',
  source: 'fallback',
  timestamp: new Date().toISOString(),
});

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'request-stress-fallback',
    role: 'fallback',
    timestamp: new Date().toISOString(),
  });
});

// Qualquer rota (GET/POST/etc.) devolve 200 com payload de degradação
app.all('*', (req, res) => {
  res.status(200).json({
    ...degradedResponse(),
    request: {
      method: req.method,
      path: req.path,
      query: req.query,
    },
  });
});

app.listen(PORT, () => {
  console.log(`🛟 request-stress-fallback em http://localhost:${PORT}`);
  console.log(`↩️  Qualquer rota → HTTP 200 + status: degraded`);
});
