# Request Stress REST API

API REST para testes de carga e stress com dashboard de métricas em tempo real.

## Início Rápido

```bash
npm install
npm start
```

Acesse o dashboard em **http://localhost:3000**

## Dashboard

O dashboard exibe em tempo real:

- **RPS** (requisições por segundo)
- **Latência** (média, P50, P95, P99, min/max)
- **Taxa de erro** e distribuição de status HTTP
- **Endpoints mais requisitados**
- **Requisições recentes** com IP e latência
- **Conexões ativas**

## Endpoints de Stress

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/stress/fast` | Resposta rápida (~1ms) |
| GET | `/api/stress/slow?delay=500` | Resposta lenta (delay em ms, max 5s) |
| GET | `/api/stress/cpu?iterations=100000` | Processamento CPU-intensivo |
| GET | `/api/stress/large?size=100` | Payload grande (até 1000 itens) |
| POST | `/api/stress/echo` | Ecoa o body JSON recebido |
| GET | `/api/stress/error?rate=50` | Erros aleatórios (taxa em %) |
| GET | `/api/stress/random` | Comportamento aleatório |
| GET | `/api/stress/health` | Health check |

## Exemplos com curl

```bash
# Requisição simples
curl http://localhost:3000/api/stress/fast

# Resposta lenta
curl "http://localhost:3000/api/stress/slow?delay=1000"

# Echo POST
curl -X POST http://localhost:3000/api/stress/echo \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Burst de 100 requisições paralelas
for i in $(seq 1 100); do
  curl -s http://localhost:3000/api/stress/fast &
done
wait
```

## Exemplos com ddosify

```bash
# 100 requisições, 10 concorrentes
ddosify -t http://localhost:3000/api/stress/fast -n 100 -c 10

# Teste de latência por 30 segundos
ddosify -t http://localhost:3000/api/stress/slow?delay=200 -n 50 -c 5 -d 30s

# Carga mista por 1 minuto
ddosify -t http://localhost:3000/api/stress/random -n 200 -c 20 -d 1m
```

## API de Métricas

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/metrics/snapshot` | Snapshot JSON das métricas |
| GET | `/api/metrics/stream` | SSE com atualizações a cada 1s |
| POST | `/api/metrics/reset` | Reseta todas as métricas |
| GET | `/api/endpoints` | Lista endpoints e exemplos |

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |

## Tecnologias

- Node.js + Express
- Chart.js (dashboard)
- Server-Sent Events (tempo real)
