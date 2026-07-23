# Request Stress Client

Cliente de carga que encaminha requisições ao **request-stress-backend** através do proxy `GET /api/call`.

```
request-stress-client
        │
        ▼
   GET /api/call?path=/api/stress/fast
        │
        ▼
   HTTP GET
        │
        ▼
request-stress-backend (porta 3000)
        │
        ▼
   resposta JSON
```

## Início rápido

Com o backend já rodando em `http://localhost:3000`:

```bash
cd request-stress-client
npm install
npm start
```

Abra **http://localhost:8080**

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `8080` | Porta do cliente |
| `BACKEND_URL` | `http://localhost:3000` | URL interna do backend (Service OpenShift) usada na carga via `/api/call` |
| `BACKEND_URL_EXTERNAL` | mesmo que `BACKEND_URL` | URL pública/rota do backend para o botão "Abrir dashboard backend" |
| `FALLBACK_URL` | `http://localhost:5001` | URL do serviço de fallback (T19) |
| `FALLBACK_ENABLED` | `true` | Se `true`, em falha/5xx do backend o client responde de forma degradada via fallback |

```bash
BACKEND_URL=http://request-stress.mercantil-http-scaling.svc:3000 \
BACKEND_URL_EXTERNAL=https://request-stress.apps.exemplo.com \
PORT=8080 npm start
```

## API do cliente

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/call?path=/api/stress/fast` | Proxy para o backend |
| GET | `/api/endpoints` | Lista endpoints do backend |
| POST | `/api/load` | Carga server-side (opcional) |
| GET | `/api/health` | Health do cliente |

### Exemplos

```bash
# Probe via proxy
curl "http://localhost:8080/api/call?path=/api/stress/fast"

# Slow com query
curl "http://localhost:8080/api/call?path=/api/stress/slow&delay=200"

# POST echo via /api/call
curl "http://localhost:8080/api/call?path=/api/stress/echo&method=POST&body=%7B%22hello%22%3Atrue%7D"
```

## UI

A interface permite:

- Testar cada endpoint 1x via `/api/call`
- Disparar carga (N requisições / concorrência) por endpoint
- Disparar carga em **todos** os endpoints do backend
- Ver resultados (RPS, latência, falhas) e log ao vivo
