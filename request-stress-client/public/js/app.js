let endpoints = [];
let stopRequested = false;
const results = new Map();

function log(message) {
  const el = document.getElementById('liveLog');
  const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${message}`;
  if (el.textContent === 'Aguardando…') {
    el.textContent = line;
  } else {
    el.textContent = `${line}\n${el.textContent}`.split('\n').slice(0, 80).join('\n');
  }
}

function methodLabel(method) {
  const map = {
    GET: 'pf-m-green',
    POST: 'pf-m-blue',
    PUT: 'pf-m-orange',
    DELETE: 'pf-m-red',
  };
  return `<span class="pf-v6-c-label pf-m-compact ${map[method] || 'pf-m-grey'}">
    <span class="pf-v6-c-label__content"><span class="pf-v6-c-label__text">${method}</span></span>
  </span>`;
}

function buildCallUrl(endpoint, paramValues) {
  const params = new URLSearchParams();
  params.set('path', endpoint.path);
  params.set('method', endpoint.method);
  for (const p of endpoint.params || []) {
    const value = paramValues[p.name] ?? p.default;
    if (value !== undefined && value !== '') params.set(p.name, value);
  }
  if (endpoint.body) {
    params.set('body', JSON.stringify(endpoint.body));
  }
  return `/api/call?${params.toString()}`;
}

function getParamValues(endpointId) {
  const card = document.querySelector(`[data-endpoint-id="${endpointId}"]`);
  const values = {};
  if (!card) return values;
  card.querySelectorAll('[data-param]').forEach((input) => {
    values[input.dataset.param] = input.value;
  });
  return values;
}

function getGlobalConfig() {
  return {
    requests: Math.min(5000, Math.max(1, parseInt(document.getElementById('globalRequests').value, 10) || 50)),
    concurrency: Math.min(200, Math.max(1, parseInt(document.getElementById('globalConcurrency').value, 10) || 10)),
  };
}

function renderEndpointCards() {
  const gallery = document.getElementById('endpointCards');
  gallery.innerHTML = endpoints.map((ep) => {
    const paramsHtml = (ep.params || []).map((p) => `
      <div class="pf-v6-c-form__group">
        <div class="pf-v6-c-form__group-label">
          <label class="pf-v6-c-form__label" for="param-${ep.id}-${p.name}">
            <span class="pf-v6-c-form__label-text">${p.label}</span>
          </label>
        </div>
        <div class="pf-v6-c-form__group-control">
          <input class="pf-v6-c-form-control" type="text" id="param-${ep.id}-${p.name}"
            data-param="${p.name}" value="${p.default}">
        </div>
      </div>
    `).join('');

    return `
      <div class="pf-v6-c-card endpoint-card" data-endpoint-id="${ep.id}">
        <div class="pf-v6-c-card__header">
          <div class="pf-v6-c-card__title">
            <h2 class="pf-v6-c-card__title-text">${methodLabel(ep.method)} ${ep.id}</h2>
          </div>
        </div>
        <div class="pf-v6-c-card__body">
          <p class="pf-v6-u-mb-sm">${ep.description}</p>
          <p class="endpoint-path pf-v6-u-text-color-subtle pf-v6-u-mb-md">${ep.path}</p>
          <form class="pf-v6-c-form" onsubmit="return false;">
            ${paramsHtml || '<p class="pf-v6-u-text-color-subtle">Sem parâmetros extras</p>'}
          </form>
          <div class="endpoint-actions">
            <button class="pf-v6-c-button pf-m-secondary pf-m-small" type="button" data-action="probe" data-id="${ep.id}">
              Testar 1x (/api/call)
            </button>
            <button class="pf-v6-c-button pf-m-primary pf-m-small" type="button" data-action="load" data-id="${ep.id}">
              Disparar carga
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderResults() {
  const tbody = document.getElementById('resultsBody');
  if (!results.size) {
    tbody.innerHTML = `<tr class="pf-v6-c-table__tr"><td class="pf-v6-c-table__td" colspan="8">
      <div class="pf-v6-c-empty-state pf-m-xs"><div class="pf-v6-c-empty-state__content">
        <div class="pf-v6-c-empty-state__body">Nenhuma carga executada ainda</div>
      </div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = [...results.values()].map((r) => `
    <tr class="pf-v6-c-table__tr">
      <td class="pf-v6-c-table__td">${methodLabel(r.method)} <code>${r.path}</code></td>
      <td class="pf-v6-c-table__td">${r.requests}</td>
      <td class="pf-v6-c-table__td">${r.success}</td>
      <td class="pf-v6-c-table__td">${r.failed}</td>
      <td class="pf-v6-c-table__td">${r.rps}</td>
      <td class="pf-v6-c-table__td">${r.avgLatency}ms</td>
      <td class="pf-v6-c-table__td">${r.p95}ms</td>
      <td class="pf-v6-c-table__td">
        <span class="pf-v6-c-label pf-m-compact ${r.failed ? 'pf-m-warning' : 'pf-m-success'}">
          <span class="pf-v6-c-label__content"><span class="pf-v6-c-label__text">${r.failed ? 'Parcial' : 'OK'}</span></span>
        </span>
      </td>
    </tr>
  `).join('');
}

async function runPool(total, concurrency, worker) {
  const resultsArr = new Array(total);
  let next = 0;

  async function runWorker() {
    while (next < total) {
      if (stopRequested) break;
      const index = next++;
      resultsArr[index] = await worker(index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => runWorker()));
  return resultsArr.filter((r) => r !== undefined);
}

/**
 * Carga via UI → GET /api/call → backend
 */
async function runLoadViaCall(endpoint) {
  const { requests, concurrency } = getGlobalConfig();
  const paramValues = getParamValues(endpoint.id);
  const callUrl = buildCallUrl(endpoint, paramValues);

  log(`Iniciando carga ${endpoint.method} ${endpoint.path} — ${requests} req, conc=${concurrency}`);
  log(`Via ${callUrl}`);

  const started = performance.now();
  const batch = await runPool(requests, concurrency, async () => {
    const t0 = performance.now();
    try {
      const res = await fetch(callUrl);
      const durationMs = performance.now() - t0;
      return { ok: res.ok, statusCode: res.status, durationMs };
    } catch (error) {
      return { ok: false, statusCode: 0, durationMs: performance.now() - t0, error: error.message };
    }
  });
  const elapsedMs = performance.now() - started;

  const success = batch.filter((r) => r.ok).length;
  const failed = batch.length - success;
  const durations = batch.map((r) => r.durationMs).sort((a, b) => a - b);
  const avg = durations.reduce((s, d) => s + d, 0) / (durations.length || 1);
  const p95 = durations[Math.max(0, Math.ceil(0.95 * durations.length) - 1)] || 0;

  const summary = {
    id: endpoint.id,
    method: endpoint.method,
    path: endpoint.path,
    requests: batch.length,
    success,
    failed,
    rps: Number((batch.length / (elapsedMs / 1000)).toFixed(1)),
    avgLatency: Math.round(avg),
    p95: Math.round(p95),
  };

  results.set(endpoint.id, summary);
  renderResults();
  log(`Concluído ${endpoint.path}: ${success}/${batch.length} OK, RPS=${summary.rps}, avg=${summary.avgLatency}ms`);
  return summary;
}

async function probeOnce(endpoint) {
  const paramValues = getParamValues(endpoint.id);
  const callUrl = buildCallUrl(endpoint, paramValues);
  log(`Probe: ${callUrl}`);
  const res = await fetch(callUrl);
  const json = await res.json();
  log(`Probe status=${res.status} backend=${json.backend?.statusCode} ${json.backend?.durationMs}ms`);
  return json;
}

function setRunning(running) {
  document.getElementById('runAllBtn').disabled = running;
  document.getElementById('stopBtn').disabled = !running;
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.disabled = running;
  });
}

async function init() {
  const meta = await fetch('/api/endpoints').then((r) => r.json());
  endpoints = meta.endpoints;
  document.querySelector('#backendStatus .pf-v6-c-label__text').textContent = `Backend: ${meta.backendUrl}`;
  document.getElementById('backendDashboardLink').href = meta.backendUrlExternal || meta.backendUrl;
  renderEndpointCards();
  log(`Cliente pronto. Backend (carga): ${meta.backendUrl}`);
  log(`Dashboard externo: ${meta.backendUrlExternal || meta.backendUrl}`);

  document.getElementById('endpointCards').addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const endpoint = endpoints.find((e) => e.id === btn.dataset.id);
    if (!endpoint) return;

    stopRequested = false;
    setRunning(true);
    try {
      if (btn.dataset.action === 'probe') await probeOnce(endpoint);
      if (btn.dataset.action === 'load') await runLoadViaCall(endpoint);
    } catch (error) {
      log(`Erro: ${error.message}`);
    } finally {
      setRunning(false);
    }
  });

  document.getElementById('runAllBtn').addEventListener('click', async () => {
    stopRequested = false;
    setRunning(true);
    log('Disparando carga em todos os endpoints…');
    try {
      for (const endpoint of endpoints) {
        if (stopRequested) break;
        await runLoadViaCall(endpoint);
      }
      log(stopRequested ? 'Carga interrompida.' : 'Carga em todos os endpoints finalizada.');
    } catch (error) {
      log(`Erro: ${error.message}`);
    } finally {
      setRunning(false);
    }
  });

  document.getElementById('stopBtn').addEventListener('click', () => {
    stopRequested = true;
    log('Parada solicitada…');
  });
}

init().catch((error) => {
  log(`Falha ao iniciar: ${error.message}`);
});
