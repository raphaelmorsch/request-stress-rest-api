const BACKEND_ENDPOINTS = [
  {
    id: 'fast',
    method: 'GET',
    path: '/api/stress/fast',
    description: 'Resposta rápida (~1ms)',
    params: [],
  },
  {
    id: 'slow',
    method: 'GET',
    path: '/api/stress/slow',
    description: 'Resposta lenta (delay configurável)',
    params: [{ name: 'delay', default: '500', label: 'Delay (ms)' }],
  },
  {
    id: 'cpu',
    method: 'GET',
    path: '/api/stress/cpu',
    description: 'Processamento CPU-intensivo',
    params: [{ name: 'iterations', default: '100000', label: 'Iterações' }],
  },
  {
    id: 'large',
    method: 'GET',
    path: '/api/stress/large',
    description: 'Payload grande',
    params: [{ name: 'size', default: '100', label: 'Tamanho' }],
  },
  {
    id: 'echo',
    method: 'POST',
    path: '/api/stress/echo',
    description: 'Ecoa o body JSON recebido',
    params: [],
    body: { test: true, source: 'request-stress-client' },
  },
  {
    id: 'error',
    method: 'GET',
    path: '/api/stress/error',
    description: 'Erros aleatórios',
    params: [{ name: 'rate', default: '50', label: 'Taxa de erro (%)' }],
  },
  {
    id: 'random',
    method: 'GET',
    path: '/api/stress/random',
    description: 'Comportamento aleatório',
    params: [],
  },
  {
    id: 'health',
    method: 'GET',
    path: '/api/stress/health',
    description: 'Health check',
    params: [],
  },
];

module.exports = { BACKEND_ENDPOINTS };
