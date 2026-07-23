const { Router } = require('express');
const metrics = require('../metrics/collector');

const router = Router();

router.get('/snapshot', (_req, res) => {
  res.json(metrics.getSnapshot());
});

router.get('/prometheus', (_req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(metrics.toPrometheus());
});

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = () => {
    res.write(`data: ${JSON.stringify(metrics.getSnapshot())}\n\n`);
  };

  send();
  const interval = setInterval(send, 1000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

router.post('/reset', (_req, res) => {
  metrics.reset();
  res.json({ status: 'ok', message: 'Métricas resetadas' });
});

module.exports = router;
