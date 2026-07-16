const express = require('express');
const path = require('path');
const { BACKEND_ENDPOINTS } = require('./endpoints');
const callRoutes = require('./routes/call');
const loadRoutes = require('./routes/load');

const app = express();
const PORT = process.env.PORT || 4000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const BACKEND_URL_EXTERNAL =
  process.env.BACKEND_URL_EXTERNAL || process.env.BACKEND_URL || 'http://localhost:3000';

app.set('backendUrl', BACKEND_URL.replace(/\/$/, ''));
app.set('backendUrlExternal', BACKEND_URL_EXTERNAL.replace(/\/$/, ''));
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    client: 'request-stress-client',
    backendUrl: app.get('backendUrl'),
    backendUrlExternal: app.get('backendUrlExternal'),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/endpoints', (_req, res) => {
  res.json({
    client: 'request-stress-client',
    backendUrl: app.get('backendUrl'),
    backendUrlExternal: app.get('backendUrlExternal'),
    flow: 'UI → GET /api/call → HTTP → request-stress-backend',
    endpoints: BACKEND_ENDPOINTS,
    callExample: '/api/call?path=/api/stress/fast',
  });
});

app.use('/api/call', callRoutes);
app.use('/api/load', loadRoutes);

app.use(
  '/patternfly',
  express.static(path.join(__dirname, '../node_modules/@patternfly/patternfly'))
);
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🎯 request-stress-client em http://localhost:${PORT}`);
  console.log(`➡️  Backend (carga): ${app.get('backendUrl')}`);
  console.log(`🌐 Backend (externo/dashboard): ${app.get('backendUrlExternal')}`);
  console.log(`📞 Proxy: GET http://localhost:${PORT}/api/call?path=/api/stress/fast`);
});
