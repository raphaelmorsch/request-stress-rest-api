# Request Stress REST API

Monorepo com **request-stress-backend** (API + dashboard), **request-stress-client** (gerador de carga) e **request-stress-fallback** (resposta degradada).

```
request-stress-client (:4000)
        │
        ▼
   GET /api/call
        │
        ▼
   HTTP
        │
        ├──────────────────► request-stress-backend (:3000)
        │                         resposta + métricas
        │
        └──────────────────► request-stress-fallback (:5001)
                              HTTP 200 + status: degraded
```

## Início Rápido

```bash
# Backend (app atual)
npm install
npm start

# Cliente (outro terminal)
npm --prefix request-stress-client install
npm run start:client

# Fallback (outro terminal)
npm --prefix request-stress-fallback install
npm run start:fallback
```

- Backend / Dashboard: **http://localhost:3000**
- Cliente de carga: **http://localhost:4000**
- Fallback: **http://localhost:5001**

Detalhes do cliente: [request-stress-client/README.md](./request-stress-client/README.md)  
Detalhes do fallback: [request-stress-fallback/README.md](./request-stress-fallback/README.md)

## Dashboard

Interface construída com [PatternFly](https://www.patternfly.org/) 6 (Page, Masthead, Card, Table, Label, CodeBlock).

O dashboard exibe em tempo real:

- **RPS** (requisições por segundo)
- **Latência** (média, P50, P95, P99, min/max)
- **Taxa de erro** e distribuição de status HTTP
- **Endpoints mais requisitados**
- **Requisições recentes** com IP e latência
- **Conexões ativas**

## Endpoints de Stress


| Método | Endpoint                            | Descrição                            |
| ------ | ----------------------------------- | ------------------------------------ |
| GET    | `/api/stress/fast`                  | Resposta rápida (~1ms)               |
| GET    | `/api/stress/slow?delay=500`        | Resposta lenta (delay em ms, max 5s) |
| GET    | `/api/stress/cpu?iterations=100000` | Processamento CPU-intensivo          |
| GET    | `/api/stress/large?size=100`        | Payload grande (até 1000 itens)      |
| POST   | `/api/stress/echo`                  | Ecoa o body JSON recebido            |
| GET    | `/api/stress/error?rate=50`         | Erros aleatórios (taxa em %)         |
| GET    | `/api/stress/random`                | Comportamento aleatório              |
| GET    | `/api/stress/health`                | Health check                         |




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


| Método | Endpoint                | Descrição                      |
| ------ | ----------------------- | ------------------------------ |
| GET    | `/api/metrics/snapshot` | Snapshot JSON das métricas     |
| GET    | `/api/metrics/stream`   | SSE com atualizações a cada 1s |
| POST   | `/api/metrics/reset`    | Reseta todas as métricas       |
| GET    | `/api/endpoints`        | Lista endpoints e exemplos     |




## Variáveis de Ambiente


| Variável | Padrão | Descrição         |
| -------- | ------ | ----------------- |
| `PORT`   | `3000` | Porta do servidor |




## Tecnologias

- Node.js + Express
- [PatternFly](https://www.patternfly.org/) 6 (UI)
- Chart.js (gráficos)
- Server-Sent Events (tempo real)



## Autoscaling HTTP com OpenShift Custom Metrics Autoscaler e KEDA HTTP Add-on

Este cenário demonstra como escalar uma aplicação HTTP com base na quantidade de requisições simultâneas, incluindo:

- escalabilidade orientada por tráfego HTTP;
- scale-to-zero;
- cold start automático;
- encaminhamento das requisições pelo interceptor do KEDA;
- criação automática do HPA;
- scale-out durante carga;
- scale-down após o encerramento da carga.

A aplicação utilizada foi:

```text
https://github.com/raphaelmorsch/request-stress-rest-api
```



### Arquitetura

O tráfego utilizado no teste segue este caminho:

```text
ddosify / curl
       │
       ▼
OpenShift Route
       │
       ▼
KEDA HTTP Interceptor
       │
       ▼
InterceptorRoute
       │
       ▼
Service da aplicação
       │
       ▼
Deployment
       │
       ▲
ScaledObject → KEDA → HPA
```

A Route utilizada pelo teste não aponta diretamente para o Service da aplicação. Ela aponta para o interceptor do KEDA HTTP Add-on.

---



## 1. Pré-requisitos

O cluster deve possuir:

- Red Hat OpenShift;
- Custom Metrics Autoscaler Operator;
- uma instância de `KedaController`;
- KEDA HTTP Add-on;
- aplicação implantada com um `Deployment` e um `Service`;
- Helm instalado na estação administrativa;
- `oc` autenticado no cluster;
- `ddosify` instalado para geração de carga.

Validar o KEDA Core:

```bash
oc get kedacontroller -A
oc get pods -n openshift-keda
oc get crd scaledobjects.keda.sh
oc get apiservice | grep external.metrics
```

Validar os CRDs do HTTP Add-on:

```bash
oc get crd | grep http.keda.sh
```

Validar os componentes do HTTP Add-on:

```bash
oc get deploy,pods,svc -n openshift-keda \
  | grep -E 'keda-add-ons-http|interceptor|external-scaler'
```

O ambiente deve possuir componentes equivalentes a:

```text
keda-add-ons-http-controller-manager
keda-add-ons-http-external-scaler
keda-add-ons-http-interceptor
keda-add-ons-http-interceptor-proxy
```

---



## 2. Instalação do KEDA HTTP Add-on no OpenShift

Adicionar o repositório Helm:

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
```

O chart padrão do HTTP Add-on utiliza valores fixos de `fsGroup` e `supplementalGroups`, incompatíveis com a faixa dinâmica de UID/GID aplicada pelo SCC `restricted-v2` do OpenShift.

Criar o arquivo `values-openshift.yaml`:

```yaml
operator:
  watchNamespace: mercantil-http-scaling

podSecurityContext:
  fsGroup: null
  supplementalGroups: null

securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  privileged: false
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
```

Renderizar os manifests antes da instalação:

```bash
helm template keda-add-ons-http \
  kedacore/keda-add-ons-http \
  --version 0.15.0 \
  --namespace openshift-keda \
  -f values-openshift.yaml \
  > /tmp/keda-http-rendered.yaml
```

Confirmar que não existem grupos fixos:

```bash
grep -n -E 'fsGroup|supplementalGroups|runAsUser|runAsGroup' \
  /tmp/keda-http-rendered.yaml
```

Instalar o HTTP Add-on:

```bash
helm install keda-add-ons-http \
  kedacore/keda-add-ons-http \
  --version 0.15.0 \
  --namespace openshift-keda \
  -f values-openshift.yaml \
  --wait \
  --timeout 5m
```

Validar:

```bash
helm status keda-add-ons-http -n openshift-keda
```

```bash
oc get pods -n openshift-keda \
  -l app.kubernetes.io/instance=keda-add-ons-http
```

Confirmar a SCC aplicada:

```bash
oc get pods -n openshift-keda \
  -l app.kubernetes.io/instance=keda-add-ons-http \
  -o custom-columns='POD:.metadata.name,STATUS:.status.phase,SCC:.metadata.annotations.openshift\.io/scc'
```

O esperado é que os Pods sejam admitidos pelo SCC:

```text
restricted-v2
```

> O HTTP Add-on complementa o KEDA Core. Ele não substitui o Custom Metrics Autoscaler Operator.

---



## 3. Definição das variáveis do cenário

```bash
APP_NAMESPACE=mercantil-http-scaling
DEPLOYMENT=request-stress
SERVICE=request-stress
APP_PORT=3000
```

Confirmar os recursos:

```bash
oc get deploy "$DEPLOYMENT" -n "$APP_NAMESPACE"
oc get svc "$SERVICE" -n "$APP_NAMESPACE"
oc get pods -n "$APP_NAMESPACE"
```

Validar a porta do Service:

```bash
oc get svc "$SERVICE" -n "$APP_NAMESPACE" -o yaml
```

O Service deve apresentar uma configuração equivalente a:

```yaml
spec:
  ports:
    - name: http
      port: 3000
      targetPort: 3000
```

Testar diretamente pelo Service:

```bash
oc run curl-test \
  -n "$APP_NAMESPACE" \
  --rm -it \
  --restart=Never \
  --image=curlimages/curl \
  -- curl -i "http://${SERVICE}:${APP_PORT}/api/stress/health"
```

---



## 4. Verificação de HPAs existentes

Um Deployment não deve ser controlado simultaneamente por dois HPAs.

Listar os HPAs e seus respectivos alvos:

```bash
oc get hpa -n "$APP_NAMESPACE" \
  -o custom-columns='NAME:.metadata.name,TARGET:.spec.scaleTargetRef.name'
```

Caso exista outro HPA apontando para o mesmo Deployment, ele deve ser removido antes de aplicar o `ScaledObject`:

```bash
oc delete hpa <NOME_DO_HPA> -n "$APP_NAMESPACE"
```

---



## 5. Definição do hostname do cenário KEDA

Obter o domínio de aplicações do cluster:

```bash
APPS_DOMAIN=$(oc get ingresses.config.openshift.io cluster \
  -o jsonpath='{.spec.domain}')
```

Definir um hostname exclusivo para o cenário:

```bash
KEDA_HOST="request-stress-keda.${APPS_DOMAIN}"

echo "$KEDA_HOST"
```

Exemplo:

```text
request-stress-keda.apps.cluster-z5jsv.dynamic2.redhatworkshops.io
```

A Route original da aplicação pode continuar existindo e apontando diretamente para o Service.

A Route KEDA será uma segunda Route, exclusiva para o teste:

```text
Route original
  → Service da aplicação

Route KEDA
  → HTTP Interceptor
  → Service da aplicação
```

---



## 6. Criação do InterceptorRoute

O `InterceptorRoute` relaciona:

- o hostname recebido pelo interceptor;
- o Service de destino;
- a métrica HTTP utilizada para autoscaling.

Criar `interceptor-route.yaml`:

```yaml
apiVersion: http.keda.sh/v1beta1
kind: InterceptorRoute
metadata:
  name: request-stress-rest-api
  namespace: mercantil-http-scaling
spec:
  target:
    service: request-stress
    port: 3000

  rules:
    - hosts:
        - request-stress-keda.apps.cluster-z5jsv.dynamic2.redhatworkshops.io
      pathPrefixes:
        - /

  scalingMetric:
    concurrency:
      targetValue: 5

  timeouts:
    conditionWait: 60s
    responseHeader: 60s
```

Aplicar:

```bash
oc apply -f interceptor-route.yaml
```

Validar:

```bash
oc get interceptorroute request-stress-rest-api \
  -n "$APP_NAMESPACE"
```

```bash
oc describe interceptorroute request-stress-rest-api \
  -n "$APP_NAMESPACE"
```

O parâmetro:

```yaml
scalingMetric:
  concurrency:
    targetValue: 5
```

indica uma meta aproximada de cinco requisições simultâneas por réplica.

---



## 7. Criação do ScaledObject

Criar `scaledobject-http.yaml`:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: request-stress-rest-api-http
  namespace: mercantil-http-scaling
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: request-stress

  pollingInterval: 2
  cooldownPeriod: 30
  initialCooldownPeriod: 10

  minReplicaCount: 0
  maxReplicaCount: 10

  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
            - type: Pods
              value: 4
              periodSeconds: 15
            - type: Percent
              value: 100
              periodSeconds: 15
          selectPolicy: Max

        scaleDown:
          stabilizationWindowSeconds: 15
          policies:
            - type: Percent
              value: 100
              periodSeconds: 15

  triggers:
    - type: external-push
      metadata:
        scalerAddress: >-
          keda-add-ons-http-external-scaler.openshift-keda.svc.cluster.local:9090
        interceptorRoute: request-stress-rest-api
```

Aplicar:

```bash
oc apply -f scaledobject-http.yaml
```

Validar:

```bash
oc get scaledobject,hpa -n "$APP_NAMESPACE"
```

```bash
oc describe scaledobject request-stress-rest-api-http \
  -n "$APP_NAMESPACE"
```

O estado inicial esperado é:

```text
Ready:  True
Active: False
```

Quando não existem requisições ativas, o KEDA reduz o Deployment para zero:

```text
KEDAScaleTargetDeactivated
Deactivated apps/v1.Deployment mercantil-http-scaling/request-stress from 1 to 0
```

O `ScaledObject` cria automaticamente um HPA com nome semelhante a:

```text
keda-hpa-request-stress-rest-api-http
```

A métrica externa criada possui um nome equivalente a:

```text
s0-http_request-stress-rest-api_concurrency
```

---



## 8. Criação da Route para o interceptor

A Route KEDA deve apontar para:

```text
keda-add-ons-http-interceptor-proxy
```

Esse Service está no namespace `openshift-keda`. Por isso, a Route também deve ser criada nesse namespace.

Validar o Service:

```bash
oc get svc keda-add-ons-http-interceptor-proxy \
  -n openshift-keda
```

Criar a Route:

```bash
oc create route edge request-stress-keda \
  --service=keda-add-ons-http-interceptor-proxy \
  --hostname="$KEDA_HOST" \
  --port=8080 \
  --insecure-policy=Redirect \
  -n openshift-keda
```

Validar:

```bash
oc get route request-stress-keda \
  -n openshift-keda \
  -o jsonpath='host={.spec.host} service={.spec.to.name}{"\n"}'
```

Resultado esperado:

```text
host=request-stress-keda.apps.cluster-z5jsv.dynamic2.redhatworkshops.io
service=keda-add-ons-http-interceptor-proxy
```

---



## 9. Teste de scale-from-zero

Confirmar que a aplicação está com zero réplicas:

```bash
oc get deploy "$DEPLOYMENT" -n "$APP_NAMESPACE"
```

```bash
oc get pods -n "$APP_NAMESPACE"
```

Abrir um terminal acompanhando a criação dos Pods:

```bash
oc get pods -n "$APP_NAMESPACE" -w
```

Em outro terminal, acessar o endpoint de saúde:

```bash
curl -sk -i \
  "https://${KEDA_HOST}/api/stress/health"
```

A resposta deve conter:

```text
HTTP/1.1 200 OK
x-keda-http-cold-start: true
```

O header:

```text
x-keda-http-cold-start: true
```

comprova que:

1. a requisição chegou enquanto a aplicação estava em zero;
2. o interceptor ativou o workload;
3. o KEDA criou uma réplica;
4. o interceptor aguardou a aplicação ficar disponível;
5. a requisição foi encaminhada;
6. o cliente recebeu HTTP 200.

Exemplo de resposta:

```json
{
  "status": "healthy",
  "uptime": 0.48,
  "memory": {
    "rss": 70053888,
    "heapTotal": 16007168,
    "heapUsed": 8653928
  }
}
```

---



## 10. Teste de carga com ddosify

Foi utilizado o endpoint:

```text
/api/stress/slow?delay=1000
```

Cada chamada permanece ativa por aproximadamente um segundo, tornando a métrica de concorrência mais evidente.

Gerar aproximadamente 30 requisições por segundo durante dois minutos:

```bash
ddosify \
  -t "https://${KEDA_HOST}/api/stress/slow?delay=1000" \
  -n 3600 \
  -d 120 \
  -l linear
```

Cálculo da taxa:

```text
3600 requisições / 120 segundos = 30 requisições por segundo
```

Como cada requisição permanece aberta por cerca de um segundo:

```text
30 requisições por segundo
≈ 30 requisições simultâneas
```

Com a meta configurada para cinco requisições simultâneas por réplica:

```text
30 concorrentes / 5 por réplica
≈ 6 réplicas
```

O número efetivo pode variar de acordo com:

- tempo de inicialização dos Pods;
- latência das requisições;
- capacidade do gerador de carga;
- janela de estabilização do HPA;
- tempo de reconciliação do KEDA.

---



## 11. Acompanhamento do autoscaling

Terminal 1 — Deployment e Pods:

```bash
watch -n 1 "
echo '=== DEPLOYMENT ==='
oc get deploy ${DEPLOYMENT} -n ${APP_NAMESPACE}

echo
echo '=== PODS ==='
oc get pods -n ${APP_NAMESPACE} -o wide
"
```

Terminal 2 — ScaledObject e HPA:

```bash
watch -n 1 "
echo '=== KEDA ==='
oc get scaledobject -n ${APP_NAMESPACE}

echo
echo '=== HPA ==='
oc get hpa -n ${APP_NAMESPACE}
"
```

Terminal 3 — eventos:

```bash
oc get events \
  -n "$APP_NAMESPACE" \
  --sort-by=.lastTimestamp \
  -w
```

Terminal 4 — geração de carga:

```bash
ddosify \
  -t "https://${KEDA_HOST}/api/stress/slow?delay=1000" \
  -n 3600 \
  -d 120 \
  -l linear
```

---



## 12. Resultado do teste

O teste executou:

```text
3600 requisições
```

Resultado:

```text
Success Count: 3600
Failed Count:  0
```

Distribuição dos códigos HTTP:

```text
200 OK: 3600
```

Tempo médio:

```text
Server Processing: aproximadamente 1,20 s
Total:             aproximadamente 1,24 s
```

Resumo:

```text
Successful Run: 3600
Failed Run: 0
Success Rate: 100%
```

Durante a carga, o Custom Metrics Autoscaler utilizou a métrica de concorrência fornecida pelo KEDA HTTP Add-on para aumentar o número de réplicas do Deployment.

---



## 13. Validação do scale-to-zero

Após o término do ddosify, interromper todas as chamadas e acompanhar:

```bash
watch -n 2 "
oc get deploy ${DEPLOYMENT} -n ${APP_NAMESPACE}
echo
oc get scaledobject,hpa -n ${APP_NAMESPACE}
"
```

Com a configuração:

```yaml
cooldownPeriod: 30
minReplicaCount: 0
```

o comportamento esperado é:

```text
Carga termina
      ↓
requisições concorrentes chegam a zero
      ↓
HPA reduz o número de réplicas
      ↓
cooldown de 30 segundos
      ↓
Deployment retorna para zero réplicas
```

Validar:

```bash
oc get deploy "$DEPLOYMENT" -n "$APP_NAMESPACE"
```

Resultado esperado:

```text
READY   UP-TO-DATE   AVAILABLE
0/0     0            0
```

---



## 14. Evidências recomendadas

Antes da carga:

```bash
oc get deploy,pods,scaledobject,hpa \
  -n "$APP_NAMESPACE"
```

Durante a carga:

```bash
oc get deploy,pods,scaledobject,hpa \
  -n "$APP_NAMESPACE"
```

Depois da carga:

```bash
oc get deploy,pods,scaledobject,hpa \
  -n "$APP_NAMESPACE"
```

Detalhes do ScaledObject:

```bash
oc describe scaledobject request-stress-rest-api-http \
  -n "$APP_NAMESPACE"
```

Detalhes do HPA:

```bash
oc describe hpa keda-hpa-request-stress-rest-api-http \
  -n "$APP_NAMESPACE"
```

Eventos do namespace:

```bash
oc get events \
  -n "$APP_NAMESPACE" \
  --sort-by=.lastTimestamp \
  | tail -50
```

Validar a Route:

```bash
oc get route request-stress-keda \
  -n openshift-keda \
  -o jsonpath='host={.spec.host} service={.spec.to.name}{"\n"}'
```

Validar o `InterceptorRoute`:

```bash
oc get interceptorroute request-stress-rest-api \
  -n "$APP_NAMESPACE" \
  -o yaml
```

---



## 15. Resultado observado

O cenário comprovou:

- ativação automática de uma aplicação com zero réplicas;
- retenção da primeira requisição durante o cold start;
- resposta HTTP 200 após a inicialização do Pod;
- escalabilidade baseada em concorrência HTTP;
- criação automática do HPA pelo KEDA;
- scale-out durante a carga;
- processamento de 3.600 requisições sem erros;
- scale-down após o encerramento das requisições;
- retorno automático do Deployment para zero réplicas.

Fluxo final:

```text
Sem tráfego
   ↓
0 Pods
   ↓
Primeira requisição
   ↓
HTTP Interceptor
   ↓
KEDA ativa o Deployment
   ↓
Pod fica Ready
   ↓
HTTP 200
   ↓
Carga aumenta
   ↓
Número de Pods aumenta
   ↓
Carga termina
   ↓
Número de Pods diminui
   ↓
0 Pods
```

