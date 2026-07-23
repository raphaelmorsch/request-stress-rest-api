# Request Stress REST API

Monorepo com **request-stress-backend** (API + dashboard), **request-stress-client** (gerador de carga) e **request-stress-fallback** (resposta degradada).

```
request-stress-client (:8080)
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
- Cliente de carga: **http://localhost:8080**
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



## GitOps + OpenShift Service Mesh (casos T09, T19, T20, T21 e T22)

Esta seção documenta o cenário montado para o caderno de testes da PoC Mercantil, cobrindo:

| ID | Caso | Capacidade demonstrada |
|----|------|------------------------|
| **T09** | Configuração sem hardcode (mudança de endpoint) | ConfigMap central + rollout via GitOps |
| **T19** | Indisponibilidade de API dependente | Fault injection (abort) no Service Mesh + fallback degradado |
| **T20** | Circuit breaker e retries | `DestinationRule` (outlierDetection) + `VirtualService` (retries) |
| **T21** | Atualização sem interrupção sob carga | Rolling update com `maxUnavailable: 0` |
| **T22** | Rollback em caso de falha | Deploy quebrado + retorno ao estado desejado (GitOps) |

Os manifests estão em `gitops/`. O runbook operacional (CLI) está em [`gitops/TEST-RUNBOOK.md`](./gitops/TEST-RUNBOOK.md). Abaixo, o passo a passo **reproduzível pela OpenShift Web Console**.

### Arquitetura do cenário

```text
Usuário / curl / browser
        │
        ▼
Route (edge TLS)
        │
        ▼
request-stress-client  (:8080)  ←── ConfigMap (BACKEND_URL / FALLBACK_URL)  [T09]
        │
        │  HTTP interno (mesh)
        ▼
request-stress (backend :3000)
        │
        ├── VirtualService (retries)           [T20]
        ├── DestinationRule (circuit breaker)  [T20]
        ├── Fault injection abort 503          [T19]
        │
        └── em falha → request-stress-fallback (:5001)  [T19]
                         resposta HTTP 200 status=degraded

Sidecar Istio injetado em todos os Pods do namespace mercantil-mesh.
Control plane: ServiceMeshControlPlane "basic" em istio-system (+ Kiali).
Entrega contínua: OpenShift GitOps (Argo CD) sincroniza overlays/prod.
```

Microsserviços:

| Componente | Função | Porta |
|------------|--------|-------|
| `request-stress` | API + dashboard de métricas (backend) | 3000 |
| `request-stress-client` | Proxy `/api/call` + gerador de carga | 8080 |
| `request-stress-fallback` | Resposta degradada quando o backend falha | 5001 |

### Pré-requisitos na console

1. Acesse a **OpenShift Web Console** como usuário com privilégios de cluster-admin (ou equivalente para instalar Operators e CRs de mesh).
2. Confirme que o **OpenShift GitOps** já aparece em **Operators → Installed Operators** (namespace `openshift-gitops-operator` / `openshift-operators`).
3. Tenha o repositório desta aplicação disponível (clone local ou URL do GitHub) para colar YAMLs via **Import YAML** (`+` no topo à direita) quando indicado.
4. Anote o domínio de aplicações do cluster em **Administration → Cluster Settings → Configuration → Ingress** (campo *Domain*), por exemplo:

```text
apps.cluster-j9ll5.dyn.redhatworkshops.io
```

### 1. Instalação dos Operators (Service Mesh + Kiali) — OperatorHub

Se **Red Hat OpenShift Service Mesh** e **Kiali Operator** ainda não estiverem instalados:

1. No menu lateral: **Operators → OperatorHub**.
2. Pesquise **Red Hat OpenShift Service Mesh**.
3. Selecione o Operator → **Install**.
   - Update channel: `stable`
   - Installation mode: **All namespaces on the cluster**
   - Installed Namespace: `openshift-operators`
   - Update approval: **Automatic**
4. Clique em **Install** e aguarde **Succeeded** em **Operators → Installed Operators**.
5. Repita para **Kiali Operator** (`kiali-ossm`), mesmos parâmetros (channel `stable`, All namespaces, `openshift-operators`).

Validação na console:

- **Operators → Installed Operators** deve listar:
  - *Red Hat OpenShift Service Mesh 2* (CSV ~2.6.x)
  - *Kiali Operator* (CSV ~2.27.x)

> Neste ambiente de PoC, o tracing Jaeger foi desabilitado no SMCP (`tracing.type: None`) para não depender do Operator Jaeger. Kiali, Grafana e Prometheus do mesh permanecem habilitados.

### 2. Criação dos Projects (namespaces)

1. **Home → Projects → Create Project**.
2. Crie o project **`istio-system`** (control plane do mesh).
3. Crie o project **`mercantil-mesh`** (aplicações da PoC).

Alternativa: **+ → Import YAML** e cole o conteúdo de `gitops/cluster/namespaces.yaml`.

### 3. Service Mesh Control Plane e Member Roll

1. Abra **+ → Import YAML**.
2. Cole o conteúdo de `gitops/cluster/servicemesh-controlplane.yaml` (recursos `ServiceMeshControlPlane` + `ServiceMeshMemberRoll`).
3. Clique em **Create**.

O que esse manifesto faz:

- Cria o SMCP **`basic`** em `istio-system`, versão **v2.6**, com addons Kiali / Grafana / Prometheus.
- Cria o SMMR **`default`** incluindo o member **`mercantil-mesh`** (injeta sidecars Istio nesse namespace).

Acompanhar na console:

1. Mude o Project para **`istio-system`**.
2. **Workloads → Pods** — aguarde Pods como `istiod`, `istio-ingressgateway`, `istio-egressgateway`, `prometheus`, `grafana`, `kiali` em **Running**.
3. Em **Installed Operators → Red Hat OpenShift Service Mesh → ServiceMeshControlPlane**, abra `basic` e confira condição **Ready = True** (ComponentsReady).
4. Em **ServiceMeshMemberRoll**, o `default` deve mostrar `mercantil-mesh` como configured member.

Rotas de observação (após Ready), em **Networking → Routes** no project `istio-system`:

| Route | Uso |
|-------|-----|
| `kiali` | Topologia, métricas de retry/erro, evidências T18–T20 |
| `grafana` | Dashboards do mesh |
| `prometheus` | Queries Prometheus do mesh |

Exemplo neste cluster:

```text
https://kiali-istio-system.apps.cluster-j9ll5.dyn.redhatworkshops.io
```

### 4. Build das imagens de container

Os Dockerfiles na raiz do repositório são:

| Arquivo | Imagem | Tag |
|---------|--------|-----|
| `Dockerfile.backend` | `request-stress` | `v1` (e `v2` para T21) |
| `Dockerfile.client` | `request-stress-client` | `v1` |
| `Dockerfile.fallback` | `request-stress-fallback` | `v1` |

#### 4.1 Pela console (Developer perspective)

1. No seletor de perspectiva (canto superior esquerdo), escolha **Developer**.
2. Project: **`mercantil-mesh`**.
3. **+Add → Import from Git** (ou **Dockerfile**), uma vez para cada serviço:
   - Git repo: `https://github.com/raphaelmorsch/request-stress-rest-api.git`
   - Dockerfile path: `Dockerfile.backend` / `Dockerfile.client` / `Dockerfile.fallback`
   - Application name / Name: `request-stress`, `request-stress-client`, `request-stress-fallback`
   - Target port conforme a tabela acima
4. Em **Builds → Builds**, acompanhe cada Build até **Complete**.
5. Em **Builds → ImageStreams**, confirme as tags `v1`.

#### 4.2 Tag `v2` para o teste T21

1. Perspectiva **Administrator**.
2. Project `mercantil-mesh` → **Builds → ImageStreams → request-stress**.
3. Use **Actions** / YAML para criar a tag `v2` apontando para o mesmo digest de `v1`, **ou** execute na aba **Terminal** do CloudShell / pod de debug:

```bash
oc tag mercantil-mesh/request-stress:v1 mercantil-mesh/request-stress:v2
```

> Enquanto o código com fallback (`FALLBACK_URL`) e `HEALTH_FAIL` não estiver no branch remoto, prefira **BuildConfig binário** a partir do diretório local (ver `gitops/TEST-RUNBOOK.md`). Após o push para `main`, os BuildConfigs em `gitops/cluster/buildconfigs.yaml` podem ser importados via **Import YAML** e disparados em **Builds → BuildConfigs → Start Build**.

### 5. Deploy da aplicação (baseline `overlays/prod`)

1. **+ → Import YAML**.
2. Cole o resultado renderizado do Kustomize de produção **ou** aplique recurso a recurso a partir de `gitops/apps/base/`:
   - `configmap-client.yaml`
   - `backend.yaml`
   - `client.yaml`
   - `fallback.yaml`
   - `mesh-policies.yaml` (VirtualService + DestinationRules — críticos para T19/T20)

Na prática (CloudShell / máquina com `oc`):

```bash
oc apply -k gitops/apps/overlays/prod
```

3. Project **`mercantil-mesh`** → **Workloads → Deployments**:
   - `request-stress` — 2 réplicas, strategy RollingUpdate `maxUnavailable: 0`
   - `request-stress-client` — 1 réplica
   - `request-stress-fallback` — 1 réplica
4. Abra cada Pod e confirme **dois containers**: a aplicação + **`istio-proxy`** (sidecar).
5. **Networking → Routes**:
   - `request-stress`
   - `request-stress-client`

Exemplo neste cluster:

```text
http://request-stress-client-mercantil-mesh.apps.cluster-j9ll5.dyn.redhatworkshops.io
https://request-stress-mercantil-mesh.apps.cluster-j9ll5.dyn.redhatworkshops.io
```

#### Validação rápida na console / browser

1. Abra a Route do **client** → caminho `/api/health`.
2. Deve retornar JSON com `backendUrl`, `fallbackUrl` e `fallbackEnabled: true`.
3. Abra `/api/call?path=/api/stress/fast` — esperado: `status: ok`, `source: backend`.
4. Abra a Route do **backend** → `/api/stress/health` — esperado: `status: healthy`, `version: v1`.

### 6. (Opcional) Application no OpenShift GitOps / Argo CD

Para que o Argo CD sincronize automaticamente o baseline:

1. Faça push dos manifests em `gitops/` para o branch `main` do repositório.
2. **+ → Import YAML** com `gitops/argocd/application.yaml`.
3. Abra a Route do Argo CD em **Networking → Routes** no project `openshift-gitops` (nome típico `openshift-gitops-server`).
4. Login (geralmente via OpenShift OAuth).
5. Localize a Application **`request-stress-poc`**:
   - Sync Status: **Synced**
   - Health: **Healthy**
   - Path: `gitops/apps/overlays/prod`

Exemplo de URL Argo CD neste cluster:

```text
https://openshift-gitops-server-openshift-gitops.apps.cluster-j9ll5.dyn.redhatworkshops.io
```

A partir daí, cada caso de teste pode ser executado **alterando o path do Application** no Argo CD (UI) para o overlay correspondente, ou aplicando o overlay via **Import YAML** / `oc apply -k` e depois restaurando `overlays/prod`.

---

### T09 — Configuração sem hardcode (mudança de endpoint)

**Objetivo:** trocar a URL de integração em **um único ConfigMap**; o client atualiza após o rollout, sem editar código de N microsserviços.

**Artefato:** `gitops/apps/overlays/t09-endpoint-switch`  
(altera `BACKEND_URL` para o Service do fallback e anota o Deployment do client para forçar rollout)

#### Passo a passo na Web Console

1. Project **`mercantil-mesh`**.
2. **Workloads → ConfigMaps → `request-stress-client-config`**.
3. Registre o valor atual de `BACKEND_URL` (baseline aponta para `request-stress...:3000`).
4. Aplique o overlay T09 (CloudShell / Import YAML do ConfigMap + annotation de rollout), por exemplo:

```bash
oc apply -k gitops/apps/overlays/t09-endpoint-switch
```

5. **Workloads → Deployments → `request-stress-client` → Pods**: acompanhe o RollingUpdate (Pod novo Running/Ready).
6. Abra a Route do client → `/api/health`.
7. Confirme que `backendUrl` agora aponta para:

```text
http://request-stress-fallback.mercantil-mesh.svc.cluster.local:5001
```

8. Chame `/api/call?path=/api/stress/fast` e observe a resposta proveniente do novo endpoint (payload degradado do fallback, se o “backend” configurado for o fallback).

#### Evidências recomendadas (prints)

- Diff do ConfigMap (antes/depois) na console.
- Eventos / ReplicaSet novos do Deployment `request-stress-client`.
- JSON de `/api/health` com o novo `backendUrl`.
- Se usar Argo CD: tela de **App Diff** / **Sync** mostrando só a mudança de configuração.

#### Restaurar baseline

```bash
oc apply -k gitops/apps/overlays/prod
```

Na console: acompanhe novamente o rollout do client e valide `/api/health` com `BACKEND_URL` original.

---

### T19 — Indisponibilidade de API dependente

**Objetivo:** simular falha total do backend no mesh; a aplicação principal (client) **não fica indisponível** — responde de forma degradada via fallback.

**Artefato:** `gitops/apps/overlays/t19-fault-abort`  
(VirtualService com `fault.abort.httpStatus: 503` e `percentage: 100`)

#### Passo a passo na Web Console

1. Project **`mercantil-mesh`**.
2. Aplique o overlay:

```bash
oc apply -k gitops/apps/overlays/t19-fault-abort
```

3. **Administration → CustomResourceDefinitions** (filtre `VirtualService`) **ou**, com o Operator Service Mesh instalado, localize o VS `request-stress` via **Search** (`VirtualService`) no project `mercantil-mesh`.
4. Abra o YAML do VirtualService e confirme o bloco:

```yaml
fault:
  abort:
    percentage:
      value: 100
    httpStatus: 503
```

5. Na Route do **client**, acesse:

```text
/api/call?path=/api/stress/fast
```

6. Resultado esperado:

```json
{
  "status": "degraded",
  "source": "fallback",
  "message": "Backend indisponível; resposta degradada via fallback",
  "backend": { "statusCode": 503 },
  "data": { "status": "degraded", "source": "fallback" }
}
```

7. Abra o **Kiali** (Route em `istio-system`):
   - Namespace `mercantil-mesh`
   - Graph / Topology: aresta **client → request-stress** com erros 503
   - Aresta **client → request-stress-fallback** com sucesso

#### Evidências

- YAML do VirtualService com fault injection.
- Resposta JSON degradada (HTTP 200 no client).
- Screenshot do Kiali com a dependência problemática destacada.

#### Restaurar

```bash
oc apply -k gitops/apps/overlays/prod
```

Confirme no VS que o bloco `fault` sumiu e que `/api/call?path=/api/stress/fast` voltou a `source: backend` / `status: ok`.

---

### T20 — Circuit breaker e retries

**Objetivo:** retries dentro da política do mesh e circuit breaker evitando sobrecarga da dependência instável.

**Artefato (já no baseline):** `gitops/apps/base/mesh-policies.yaml`

| Recurso | Política |
|---------|----------|
| `VirtualService/request-stress` | `retries.attempts: 3`, `perTryTimeout: 2s`, `retryOn: 5xx,reset,connect-failure,refused-stream` |
| `DestinationRule/request-stress` | `outlierDetection.consecutive5xxErrors: 3`, `interval: 10s`, `baseEjectionTime: 30s` |

#### Passo a passo na Web Console

1. Project **`mercantil-mesh`**.
2. Abra o **VirtualService** `request-stress` (Search → VirtualService) e documente a seção `retries`.
3. Abra o **DestinationRule** `request-stress` e documente `outlierDetection` + `connectionPool`.
4. Gere carga com erros no backend pela Route do client (várias abas ou um Terminal na console):

```bash
CLIENT_URL=$(oc get route request-stress-client -n mercantil-mesh -o jsonpath='http://{.spec.host}')
for i in $(seq 1 50); do
  curl -sk "$CLIENT_URL/api/call?path=/api/stress/error&rate=90" -o /dev/null &
done
wait
```

5. No **Kiali**:
   - Graph do namespace `mercantil-mesh` com tráfego ativo
   - Detalhe do serviço `request-stress`: taxas de erro, retries e latência
6. Opcional: **Workloads → Pods → `request-stress-client` → Logs** do container `istio-proxy` para ver tentativas/respostas 5xx.

#### Evidências

- Screenshots do YAML das políticas na console.
- Graph/métricas do Kiali durante a carga com `/api/stress/error`.
- Observação de que o client, com `FALLBACK_ENABLED=true`, reduz a falha percebida pelo usuário (respostas degradadas em vez de indisponibilidade total).

Overlay auxiliar (apenas marca o cenário): `gitops/apps/overlays/t20-circuit-breaker`.

---

### T21 — Atualização sem interrupção (rolling update sob carga)

**Objetivo:** publicar nova versão enquanto há tráfego, sem indisponibilidade perceptível.

**Artefato:** `gitops/apps/overlays/t21-rolling-update`  
(muda a imagem para tag `v2` e o label `version: v2`, mantendo `maxUnavailable: 0` / `maxSurge: 1`)

#### Passo a passo na Web Console

1. Abra **duas abas** do browser:
   - Aba A: Route do client `/api/call?path=/api/stress/fast` (atualize várias vezes) **ou** um loop no Terminal.
   - Aba B: console OpenShift.
2. No Terminal:

```bash
CLIENT_URL=$(oc get route request-stress-client -n mercantil-mesh -o jsonpath='http://{.spec.host}')
while true; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' "$CLIENT_URL/api/call?path=/api/stress/fast")
  echo "$(date +%H:%M:%S) $code"
  sleep 0.2
done
```

3. Em outra sessão / CloudShell, dispare o rolling update:

```bash
oc apply -k gitops/apps/overlays/t21-rolling-update
```

4. Na console, project `mercantil-mesh`:
   - **Workloads → Deployments → `request-stress` → Pods**
   - Observe Pods `v1` sendo substituídos gradualmente por Pods `v2`
   - Em nenhum momento o Deployment deve ficar com zero Pods Ready (graças a `maxUnavailable: 0`)
5. No loop de carga, a maioria das respostas deve permanecer **HTTP 200**.

#### Evidências

- Timeline do Deployment / ReplicaSets (aba **Replication Controllers / ReplicaSets**).
- Log do loop de HTTP codes durante o rollout.
- Detalhe da strategy no YAML do Deployment:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

#### Restaurar

```bash
oc apply -k gitops/apps/overlays/prod
```

---

### T22 — Rollback em caso de falha

**Objetivo:** promover uma versão com falha e retornar à versão estável, com o estado desejado registrado no GitOps.

**Artefato:** `gitops/apps/overlays/t22-broken-release`  
(imagem `request-stress:v2-broken` inexistente e/ou `HEALTH_FAIL=true` para falhar readiness)

#### Passo a passo na Web Console

1. Aplique o overlay quebrado:

```bash
oc apply -k gitops/apps/overlays/t22-broken-release
```

2. **Workloads → Pods** no project `mercantil-mesh`:
   - Espere `ImagePullBackOff` / `ErrImagePull` **ou** Pods que não passam em Ready (readiness 503 se a imagem existir com `HEALTH_FAIL=true`).
3. **Workloads → Deployments → `request-stress`**:
   - Conditions / Events mostrando falha de progresso do rollout.
4. Execute o rollback para o estado desejado (baseline):

```bash
oc apply -k gitops/apps/overlays/prod
```

   Com Argo CD: na UI da Application, altere o path de volta para `gitops/apps/overlays/prod` e clique em **Sync** (ou reverta o commit no Git e deixe o auto-sync curar o cluster).

5. Confirme:
   - Pods `request-stress` **Running 2/2** novamente
   - Route do backend `/api/stress/health` → `status: healthy`
   - No Argo CD: Application **Synced / Healthy**

#### Evidências

- Events do Deployment com a falha.
- Histórico de ReplicaSets (versão quebrada vs estável).
- Tela do Argo CD antes/depois do Sync.
- Teste HTTP 200 após o rollback.

---

### Mapa rápido de artefatos × casos de teste

| Caso | Overlay / manifesto | Onde ver na console |
|------|---------------------|---------------------|
| Bootstrap mesh | `gitops/cluster/servicemesh-controlplane.yaml` | Project `istio-system` → SMCP / Pods / Routes Kiali |
| Baseline app | `gitops/apps/overlays/prod` | Project `mercantil-mesh` → Deployments, Routes, VS, DR |
| T09 | `gitops/apps/overlays/t09-endpoint-switch` | ConfigMaps + rollout do client |
| T19 | `gitops/apps/overlays/t19-fault-abort` | VirtualService (fault) + Kiali + `/api/call` |
| T20 | `gitops/apps/base/mesh-policies.yaml` | VirtualService (retries) + DestinationRule (outlierDetection) + Kiali |
| T21 | `gitops/apps/overlays/t21-rolling-update` | Deployment Pods durante carga |
| T22 | `gitops/apps/overlays/t22-broken-release` | Pods com falha + restore `prod` / Argo Sync |
| GitOps | `gitops/argocd/application.yaml` | Argo CD UI → Application `request-stress-poc` |

### Checklist de evidências da PoC (Web Console)

- [ ] Operators Service Mesh + Kiali em **Succeeded**
- [ ] SMCP `basic` **Ready** e SMMR com member `mercantil-mesh`
- [ ] Pods da app com container `istio-proxy`
- [ ] Routes do client e do backend respondendo
- [ ] **T09:** ConfigMap alterado + `/api/health` com novo endpoint
- [ ] **T19:** VS com abort + JSON `degraded`/`fallback` + graph Kiali
- [ ] **T20:** YAML retries/outlierDetection + métricas Kiali sob `/api/stress/error`
- [ ] **T21:** rolling update sob carga com codes 200 predominantes
- [ ] **T22:** falha visível + restore saudável (console e/ou Argo CD)

