const PF_COLORS = {
  blue: '#0066cc',
  purple: '#5752d1',
  red: '#c9190b',
  green: '#3e8635',
  cyan: '#009596',
  orange: '#ec7a08',
  gold: '#f0ab00',
  gray: '#6a6e73',
  text: '#c7c7c7',
  grid: 'rgba(255, 255, 255, 0.12)',
};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      ticks: { color: PF_COLORS.text, maxTicksLimit: 8, font: { size: 10 } },
      grid: { color: PF_COLORS.grid },
    },
    y: {
      ticks: { color: PF_COLORS.text, font: { size: 10 } },
      grid: { color: PF_COLORS.grid },
      beginAtZero: true,
    },
  },
};

function createLineChart(ctx, label, color) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: `${color}33`,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: chartDefaults,
  });
}

const rpsChart = createLineChart(
  document.getElementById('rpsChart'),
  'RPS',
  PF_COLORS.blue
);

const latencyChart = createLineChart(
  document.getElementById('latencyChart'),
  'Latência (ms)',
  PF_COLORS.purple
);

const errorChart = createLineChart(
  document.getElementById('errorChart'),
  'Erros',
  PF_COLORS.red
);

const statusChart = new Chart(document.getElementById('statusChart'), {
  type: 'doughnut',
  data: {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: [
        PF_COLORS.green,
        PF_COLORS.blue,
        PF_COLORS.gold,
        PF_COLORS.red,
        PF_COLORS.purple,
        PF_COLORS.cyan,
        PF_COLORS.orange,
        PF_COLORS.gray,
      ],
      borderWidth: 0,
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: { color: PF_COLORS.text, font: { size: 11 }, boxWidth: 12 },
      },
    },
  },
});

const percentileChart = new Chart(document.getElementById('percentileChart'), {
  type: 'bar',
  data: {
    labels: ['P50', 'P95', 'P99', 'Média', 'Max'],
    datasets: [{
      data: [0, 0, 0, 0, 0],
      backgroundColor: [
        PF_COLORS.green,
        PF_COLORS.blue,
        PF_COLORS.purple,
        PF_COLORS.cyan,
        PF_COLORS.red,
      ],
      borderRadius: 4,
    }],
  },
  options: {
    ...chartDefaults,
    plugins: { legend: { display: false } },
  },
});

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function methodLabelClass(method) {
  const map = {
    GET: 'pf-m-green',
    POST: 'pf-m-blue',
    PUT: 'pf-m-orange',
    PATCH: 'pf-m-purple',
    DELETE: 'pf-m-red',
  };
  return map[method] || 'pf-m-grey';
}

function statusLabelClass(code) {
  if (code < 300) return 'pf-m-success';
  if (code < 400) return 'pf-m-blue';
  if (code < 500) return 'pf-m-warning';
  return 'pf-m-danger';
}

function pfLabel(text, modifier) {
  return `<span class="pf-v6-c-label pf-m-compact ${modifier}">
    <span class="pf-v6-c-label__content">
      <span class="pf-v6-c-label__text">${text}</span>
    </span>
  </span>`;
}

function emptyTableRow(colspan, message) {
  return `<tr class="pf-v6-c-table__tr" role="row">
    <td class="pf-v6-c-table__td" colspan="${colspan}" role="cell">
      <div class="pf-v6-c-empty-state pf-m-xs">
        <div class="pf-v6-c-empty-state__content">
          <div class="pf-v6-c-empty-state__body">${message}</div>
        </div>
      </div>
    </td>
  </tr>`;
}

function updateKPIs(data) {
  document.getElementById('kpiRps').textContent = data.currentRps;
  document.getElementById('kpiTotal').textContent = data.totalRequests.toLocaleString('pt-BR');
  document.getElementById('kpiConnections').textContent = data.activeConnections;
  document.getElementById('kpiErrorRate').textContent = `${data.errorRate}%`;
  document.getElementById('kpiAvgLatency').textContent = data.latency.avg;
  document.getElementById('kpiUptime').textContent = formatUptime(data.uptime);
}

function updateLineChart(chart, history, valueKey) {
  chart.data.labels = history.map((h) => formatTime(h.time));
  chart.data.datasets[0].data = history.map((h) => h[valueKey]);
  chart.update('none');
}

function updateStatusChart(distribution) {
  statusChart.data.labels = distribution.map((d) => d.code);
  statusChart.data.datasets[0].data = distribution.map((d) => d.count);
  statusChart.update('none');
}

function updatePercentileChart(latency) {
  percentileChart.data.datasets[0].data = [
    latency.p50, latency.p95, latency.p99, latency.avg, latency.max,
  ];
  percentileChart.update('none');
}

function updateEndpointsTable(endpoints) {
  const tbody = document.querySelector('#endpointsTable tbody');
  if (!endpoints.length) {
    tbody.innerHTML = emptyTableRow(6, 'Nenhuma requisição ainda');
    return;
  }
  tbody.innerHTML = endpoints.map((e) => `
    <tr class="pf-v6-c-table__tr" role="row">
      <td class="pf-v6-c-table__td" role="cell" data-label="Método">${pfLabel(e.method, methodLabelClass(e.method))}</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Endpoint"><code class="pf-v6-c-code-block__code">${e.path}</code></td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Requisições">${e.count.toLocaleString('pt-BR')}</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Lat. média">${e.avgDuration}ms</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Min / Max">${e.minDuration}ms / ${e.maxDuration}ms</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Erros">${e.errorRate}%</td>
    </tr>
  `).join('');
}

function updateRecentTable(requests) {
  const tbody = document.querySelector('#recentTable tbody');
  if (!requests.length) {
    tbody.innerHTML = emptyTableRow(6, 'Aguardando requisições...');
    return;
  }
  tbody.innerHTML = requests.map((r) => `
    <tr class="pf-v6-c-table__tr" role="row">
      <td class="pf-v6-c-table__td" role="cell" data-label="Hora">${formatTime(new Date(r.timestamp).toISOString())}</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Método">${pfLabel(r.method, methodLabelClass(r.method))}</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Endpoint"><code class="pf-v6-c-code-block__code">${r.path}</code></td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Status">${pfLabel(r.statusCode, statusLabelClass(r.statusCode))}</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="Latência">${Math.round(r.durationMs)}ms</td>
      <td class="pf-v6-c-table__td" role="cell" data-label="IP">${r.ip || '-'}</td>
    </tr>
  `).join('');
}

function updateDashboard(data) {
  updateKPIs(data);
  updateLineChart(rpsChart, data.rpsHistory, 'rps');
  updateLineChart(latencyChart, data.latencyHistory, 'avg');
  updateLineChart(errorChart, data.errorHistory, 'errors');
  updateStatusChart(data.statusDistribution);
  updatePercentileChart(data.latency);
  updateEndpointsTable(data.topEndpoints);
  updateRecentTable(data.recentRequests);
}

function setConnectionStatus(status) {
  const el = document.getElementById('connectionStatus');
  el.className = `pf-v6-c-label pf-m-outline ${
    status === 'connected' ? 'pf-m-green' : status === 'disconnected' ? 'pf-m-red' : 'pf-m-orange'
  } ${status}`;
  const labels = {
    connected: 'Ao vivo',
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
  };
  el.querySelector('.pf-v6-c-label__text').textContent = labels[status];
}

function connectSSE() {
  setConnectionStatus('connecting');
  const source = new EventSource('/api/metrics/stream');

  source.onmessage = (event) => {
    setConnectionStatus('connected');
    updateDashboard(JSON.parse(event.data));
  };

  source.onerror = () => {
    setConnectionStatus('disconnected');
    source.close();
    setTimeout(connectSSE, 3000);
  };
}

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Resetar todas as métricas?')) return;
  await fetch('/api/metrics/reset', { method: 'POST' });
});

connectSSE();
