# Caderno de execução — T09, T19, T20, T21, T22, T23, T24, T25
# PoC OpenShift Application Platform (Mercantil)

Namespace da aplicação: `mercantil-mesh`  
Control plane mesh: `istio-system`  
GitOps: Application `request-stress-poc` (OpenShift GitOps / Argo CD)  
User Workload Monitoring: `openshift-user-workload-monitoring` (`enableUserWorkload: true`)

## Pré-requisitos

```bash
# Operators
oc get csv -n openshift-operators | grep -E 'servicemeshoperator|kiali'

# Control plane Ready
oc get smcp basic -n istio-system
oc get pods -n istio-system

# User Workload Monitoring (T23/T24)
oc get cm cluster-monitoring-config -n openshift-monitoring -o yaml | grep -A2 enableUserWorkload
oc get pods -n openshift-user-workload-monitoring

# App sincronizada
oc get application request-stress-poc -n openshift-gitops
oc get pods,svc,route,vs,dr -n mercantil-mesh
```

Rotas (após sync):

```bash
CLIENT_URL=$(oc get route request-stress-client -n mercantil-mesh -o jsonpath='http://{.spec.host}')
BACKEND_URL=$(oc get route request-stress -n mercantil-mesh -o jsonpath='https://{.spec.host}')
echo "$CLIENT_URL" "$BACKEND_URL"
```

---

## Bootstrap (uma vez)

```bash
# 1) Namespaces + SMCP + SMMR
oc apply -f gitops/cluster/namespaces.yaml
oc apply -f gitops/cluster/servicemesh-controlplane.yaml

# Aguardar SMCP Ready
oc wait --for=condition=Ready smcp/basic -n istio-system --timeout=600s

# 2) Build das imagens (após push do código para main)
oc apply -f gitops/cluster/buildconfigs.yaml
oc start-build request-stress -n mercantil-mesh --follow
oc start-build request-stress-client -n mercantil-mesh --follow
oc start-build request-stress-fallback -n mercantil-mesh --follow

# Tag v2 para T21 (mesmo digest de v1 inicialmente, ou rebuild com APP_VERSION)
oc tag mercantil-mesh/request-stress:v1 mercantil-mesh/request-stress:v2

# 3) Argo CD Application (requer manifests em origin/main)
oc apply -f gitops/argocd/application.yaml
```

Build binário local (sem push):

```bash
oc new-build --name=request-stress --binary --strategy=docker -n mercantil-mesh \
  --to='request-stress:v1' || true
oc start-build request-stress -n mercantil-mesh --from-dir=. --follow \
  --env=DOCKERFILE=Dockerfile.backend
# Preferível: usar BuildConfigs com dockerfilePath após push
```

---

## T09 — Configuração sem hardcode (mudança de endpoint)

**Objetivo:** trocar URL de integração só no ConfigMap via GitOps; apps atualizam sem editar N microsserviços.

```bash
# Baseline
curl -s "$CLIENT_URL/api/health" | jq .

# Aplicar overlay T09 (ou apontar o Argo path para overlays/t09-endpoint-switch)
oc apply -k gitops/apps/overlays/t09-endpoint-switch

# Aguardar rollout do client
oc rollout status deploy/request-stress-client -n mercantil-mesh

# Evidência: BACKEND_URL agora aponta para o fallback
curl -s "$CLIENT_URL/api/health" | jq '{backendUrl,fallbackUrl}'
curl -s "$CLIENT_URL/api/call?path=/api/stress/fast" | jq '{status,source,data}'

# Restaurar baseline
oc apply -k gitops/apps/overlays/prod
```

**Evidências:** diff do ConfigMap no Git/Argo, rollout do client, resposta vinda do novo endpoint.

---

## T19 — Indisponibilidade de API dependente

**Objetivo:** simular falha no backend; client responde de forma degradada via fallback (sem indisponibilidade total).

```bash
# Ativar fault injection abort 100% no VirtualService do backend
oc apply -k gitops/apps/overlays/t19-fault-abort

# Chamada via client → deve retornar status=degraded / source=fallback
curl -s "$CLIENT_URL/api/call?path=/api/stress/fast" | jq .

# Kiali: Topology mercantil-mesh — aresta client → backend com erros 503
# oc get route -n istio-system | grep kiali

# Restaurar
oc apply -k gitops/apps/overlays/prod
```

**Evidências:** VS com `fault.abort`, resposta degradada HTTP 200, métricas 5xx no backend no Kiali.

---

## T20 — Circuit breaker e retries

**Objetivo:** retries na política do VirtualService; outlierDetection (circuit breaker) no DestinationRule.

```bash
# Políticas já estão no baseline (mesh-policies.yaml)
oc get virtualservice request-stress -n mercantil-mesh -o yaml | grep -A20 retries
oc get destinationrule request-stress -n mercantil-mesh -o yaml | grep -A20 outlierDetection

# Gerar erros 5xx no backend para observar retries + ejeção
for i in $(seq 1 50); do
  curl -s "$CLIENT_URL/api/call?path=/api/stress/error&rate=90" -o /dev/null &
done
wait

# Evidência no Kiali: retries, outliers ejected; métricas de erro/latência
oc logs -n mercantil-mesh -l app=request-stress-client -c istio-proxy --tail=50
```

**Evidências:** YAML das políticas, métricas de retry no Kiali, redução de falhas propagadas ao client (com fallback).

---

## T21 — Rolling update sob carga

**Objetivo:** publicar nova versão com tráfego ativo sem indisponibilidade perceptível.

```bash
# Terminal 1 — carga contínua
while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$CLIENT_URL/api/call?path=/api/stress/fast")
  echo "$(date +%H:%M:%S) $code"
  sleep 0.2
done

# Terminal 2 — rolling update (maxUnavailable: 0)
oc apply -k gitops/apps/overlays/t21-rolling-update
oc rollout status deploy/request-stress -n mercantil-mesh

# Verificar versões durante o rollout
oc get pods -n mercantil-mesh -l app=request-stress -o wide -w
```

**Evidências:** poucas/nenhuma ocorrência de 5xx no loop, Pods v1→v2 graduais, Route sempre respondendo.

---

## T22 — Rollback em caso de falha

**Objetivo:** deploy de versão quebrada + retorno à versão estável via GitOps.

```bash
# Deploy quebrado (imagem inexistente ou HEALTH_FAIL)
oc apply -k gitops/apps/overlays/t22-broken-release

# Observar falha de rollout / ImagePullBackOff / readiness
oc get pods -n mercantil-mesh -l app=request-stress
oc rollout status deploy/request-stress -n mercantil-mesh --timeout=60s || true

# Rollback GitOps → baseline prod
oc apply -k gitops/apps/overlays/prod
# Se usando Argo: sync hard / reverter commit
oc rollout status deploy/request-stress -n mercantil-mesh

curl -sk "$BACKEND_URL/api/stress/health" | jq .
```

Com Argo CD (após push):

```bash
# Apontar Application para overlay quebrado, depois voltar para prod
argocd app set request-stress-poc --path gitops/apps/overlays/t22-broken-release
argocd app sync request-stress-poc
# ... evidenciar falha ...
argocd app set request-stress-poc --path gitops/apps/overlays/prod
argocd app sync request-stress-poc
```

**Evidências:** histórico de rollout (`oc rollout history`), sync do Argo, health HTTP 200 da versão estável.

---

## T23 — Observabilidade: métricas e alertas

**Objetivo:** gerar degradação controlada e validar que métricas são coletadas e o alerta dispara (console / Alertmanager).

**Pré-req:** imagem do backend com endpoint `/metrics` (rebuild se necessário) + User Workload Monitoring ativo.

```bash
# Garantir /metrics na imagem em execução
curl -sk "$BACKEND_URL/metrics" | head

# Aplicar ServiceMonitor + PrometheusRule
oc apply -k gitops/apps/overlays/t23-alerts

# Conferir scrape e regras
oc get servicemonitor,prometheusrule -n mercantil-mesh
oc logs -n openshift-user-workload-monitoring -l app.kubernetes.io/name=prometheus-user-workload --tail=30

# Gerar degradação (error rate alto) por ~2–3 minutos
for i in $(seq 1 300); do
  curl -sk "$CLIENT_URL/api/call?path=/api/stress/error&rate=90" -o /dev/null &
  sleep 0.3
done
wait

# Validar alerta (Observe → Alerting na console, ou CLI)
oc get prometheusrule request-stress-alerts -n mercantil-mesh -o yaml | grep -A5 RequestStressHighErrorRate
# Console: Observe → Alerting — filtro namespace=mercantil-mesh / RequestStressHighErrorRate = Firing

# Query rápida (Prometheus UWM / Developer Metrics)
# http_requests_errors_total / http_requests_total  e  http_request_duration_ms_avg

# Restaurar baseline (apply em prod não apaga SM/PR — remover explicitamente)
oc delete servicemonitor request-stress -n mercantil-mesh --ignore-not-found
oc delete prometheusrule request-stress-alerts -n mercantil-mesh --ignore-not-found
oc apply -k gitops/apps/overlays/prod
```

**Evidências:** YAML do ServiceMonitor/PrometheusRule, dashboard/query com métricas, alerta `RequestStressHighErrorRate` (ou HighLatency) em estado Firing, eventos correlacionados.

---

## T24 — Observabilidade: identificação de gargalos

**Objetivo:** simular latência de dependência (e opcionalmente CPU) e identificar o componente afetado com métricas/eventos.

```bash
# Baseline saudável
curl -sk -o /dev/null -w 'baseline %{time_total}s\n' "$CLIENT_URL/api/call?path=/api/stress/fast"

# --- Cenário A: latência de dependência (mesh fault.delay) ---
oc apply -k gitops/apps/overlays/t24-latency-delay
oc get virtualservice request-stress -n mercantil-mesh -o yaml | grep -A10 fault

# Latência ~2s+ no caminho client → backend
curl -sk -o /dev/null -w 'delayed %{time_total}s\n' "$CLIENT_URL/api/call?path=/api/stress/fast"
for i in $(seq 1 30); do
  curl -sk "$CLIENT_URL/api/call?path=/api/stress/fast" -o /dev/null &
done
wait

# Diagnóstico esperado:
# - Kiali: aresta client → request-stress com latência alta
# - Observe → Metrics: http_request_duration_ms_avg (se T23/SM ativo) ou métricas de Pod
# - oc get events -n mercantil-mesh --sort-by=.lastTimestamp | tail
# Conclusão: gargalo = dependência request-stress (delay no VirtualService), ns mercantil-mesh

# --- Cenário B (opcional): CPU no backend ---
# for i in $(seq 1 40); do
#   curl -sk "$CLIENT_URL/api/call?path=/api/stress/cpu&iterations=500000" -o /dev/null &
# done
# wait
# oc adm top pod -n mercantil-mesh
# Conclusão: Pod request-stress-* com CPU elevado

# Restaurar
oc apply -k gitops/apps/overlays/prod
curl -sk -o /dev/null -w 'restored %{time_total}s\n' "$CLIENT_URL/api/call?path=/api/stress/fast"
```

**Evidências:** gráficos (latência/CPU), events/logs, conclusão nomeando workload/namespace/Pod ou dependência (ex.: VS `fault.delay` em `request-stress`).

---

## T25 — Canary deployment (Service Mesh)

**Objetivo:** publicar v2 em paralelo e direcionar uma fração do tráfego (90% stable / 10% canary) via `VirtualService`, sem rolling update do Deployment estável.

**Pré-req:** tag `request-stress:v2` (bootstrap / T21).

```bash
# Garantir imagem v2
oc get istag request-stress:v2 -n mercantil-mesh || \
  oc tag mercantil-mesh/request-stress:v1 mercantil-mesh/request-stress:v2

# Aplicar canary (Deployment+Service+DR request-stress-v2 + VS com pesos)
oc apply -k gitops/apps/overlays/t25-canary
oc rollout status deploy/request-stress-v2 -n mercantil-mesh

# Conferir recursos
oc get deploy,svc,dr,vs -n mercantil-mesh | grep request-stress
oc get virtualservice request-stress -n mercantil-mesh -o yaml | grep -A30 'canary-weighted'

# Amostra de versões via client (tráfego mesh → VS → split)
for i in $(seq 1 100); do
  curl -s "$CLIENT_URL/api/call?path=/api/stress/health" \
    | jq -r '.data.version // empty'
done | sort | uniq -c

# Canary forçado por header (a partir do client no mesh)
oc exec deploy/request-stress-client -c request-stress-client -n mercantil-mesh -- \
  node -e '
fetch("http://request-stress.mercantil-mesh.svc.cluster.local:3000/api/stress/health", {
  headers: { "x-canary": "true" }
}).then(r => r.json()).then(j => console.log(JSON.stringify({ status: j.status, version: j.version })))
'

# Kiali: Graph do namespace — arestas para request-stress e request-stress-v2 (~10%)

# Restaurar baseline (oc apply não remove o Deployment v2 — apague explicitamente)
oc delete deploy/request-stress-v2 svc/request-stress-v2 dr/request-stress-v2 -n mercantil-mesh --ignore-not-found
oc apply -k gitops/apps/overlays/prod
```

Com Argo CD (`prune: true`), apontar o path de volta para `overlays/prod` remove os recursos só do canary.

**Evidências:** contagem ~90× `v1` / ~10× `v2`, YAML do VS com pesos, graph Kiali com split, header `x-canary: true` sempre em v2.

---

## Mapa de artefatos

| Caso | Artefato principal |
|------|--------------------|
| T09 | `overlays/t09-endpoint-switch` + ConfigMap `request-stress-client-config` |
| T19 | `overlays/t19-fault-abort` + fallback no client |
| T20 | `base/mesh-policies.yaml` (VS retries + DR outlierDetection) |
| T21 | `overlays/t21-rolling-update` + `maxUnavailable: 0` |
| T22 | `overlays/t22-broken-release` + restore `overlays/prod` |
| T23 | `overlays/t23-alerts` (ServiceMonitor + PrometheusRule) + `/metrics` |
| T24 | `overlays/t24-latency-delay` (VS `fault.delay`) |
| T25 | `overlays/t25-canary` (VS pesos + `request-stress-v2`) |
| GitOps | `argocd/application.yaml` |
| Mesh | `cluster/servicemesh-controlplane.yaml` |
| UWM | `cluster-monitoring-config` (`enableUserWorkload: true`) |
