# Request Stress Fallback

Serviço de fallback que simula degradação do backend: responde **HTTP 200** com payload indicando que a resposta veio do fallback.

```json
{
  "status": "degraded",
  "message": "Serviço principal temporariamente indisponível",
  "source": "fallback"
}
```

## Início rápido

```bash
cd request-stress-fallback
npm install
npm start
```

Serviço em **http://localhost:5001**

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `5001` | Porta do fallback |

## Comportamento

| Método | Endpoint | Resposta |
|--------|----------|----------|
| GET | `/api/health` | Health do próprio fallback (`status: ok`) |
| * | qualquer outra rota | HTTP 200 + `status: degraded` |

### Exemplos

```bash
curl http://localhost:5001/api/stress/fast
curl -X POST http://localhost:5001/api/stress/echo -H "Content-Type: application/json" -d '{"x":1}'
```

Uso típico no OpenShift: apontar uma rota/Service de fallback quando o backend principal estiver indisponível.
