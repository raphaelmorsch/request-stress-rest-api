# Caderno de execução — T09, T19, T20, T21, T22
# PoC OpenShift Application Platform (Mercantil)

Namespace da aplicação: `mercantil-mesh`  
Control plane mesh: `istio-system`  
GitOps: Application `request-stress-poc` (OpenShift GitOps / Argo CD)

## Pré-requisitos

```bash
# Operators
oc get csv -n openshift-operators | grep -E 'servicemeshoperator|kiali'

# Control plane Ready
oc get smcp basic -n istio-system
oc get pods -n istio-system

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

## Mapa de artefatos

| Caso | Artefato principal |
|------|--------------------|
| T09 | `overlays/t09-endpoint-switch` + ConfigMap `request-stress-client-config` |
| T19 | `overlays/t19-fault-abort` + fallback no client |
| T20 | `base/mesh-policies.yaml` (VS retries + DR outlierDetection) |
| T21 | `overlays/t21-rolling-update` + `maxUnavailable: 0` |
| T22 | `overlays/t22-broken-release` + restore `overlays/prod` |
| GitOps | `argocd/application.yaml` |
| Mesh | `cluster/servicemesh-controlplane.yaml` |
