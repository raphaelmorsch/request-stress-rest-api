const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } },
      grid: { color: 'rgba(42, 53, 72, 0.5)' },
    },
    y: {
      ticks: { color: '#64748b', font: { size: 10 } },
      grid: { color: 'rgba(42, 53, 72, 0.5)' },
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
        backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba'),
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
  'rgb(59, 130, 246)'
);

const latencyChart = createLineChart(
  document.getElementById('latencyChart'),
  'Latência (ms)',
  'rgb(168, 85, 247)'
);

const errorChart = createLineChart(
  document.getElementById('errorChart'),
  'Erros',
  'rgb(239, 68, 68)'
);

const statusChart = new Chart(document.getElementById('statusChart'), {
  type: 'doughnut',
  data: {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: [
        '#22c55e', '#3b82f6', '#f59e0b', '#ef4444',
        '#a855f7', '#06b6d4', '#ec4899', '#84cc16',
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
        labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 },
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
        'rgba(34, 197, 94, 0.7)',
        'rgba(59, 130, 246, 0.7)',
        'rgba(168, 85, 247, 0.7)',
        'rgba(6, 182, 212, 0.7)',
        'rgba(239, 68, 68, 0.7)',
      ],
      borderRadius: 6,
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

function statusClass(code) {
  if (code < 300) return 'status-2xx';
  if (code < 400) return 'status-3xx';
  if (code < 500) return 'status-4xx';
  return 'status-5xx';
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
  const labels = history.map((h) => formatTime(h.time));
  const values = history.map((h) => h[valueKey]);
  chart.data.labels = labels;
  chart.data.datasets[0].data = values;
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
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma requisição ainda</td></tr>';
    return;
  }
  tbody.innerHTML = endpoints.map((e) => `
    <tr>
      <td><span class="method-badge method-${e.method}">${e.method}</span></td>
      <td>${e.path}</td>
      <td>${e.count.toLocaleString('pt-BR')}</td>
      <td>${e.avgDuration}ms</td>
      <td>${e.minDuration}ms / ${e.maxDuration}ms</td>
      <td>${e.errorRate}%</td>
    </tr>
  `).join('');
}

function updateRecentTable(requests) {
  const tbody = document.querySelector('#recentTable tbody');
  if (!requests.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aguardando requisições...</td></tr>';
    return;
  }
  tbody.innerHTML = requests.map((r) => `
    <tr>
      <td>${formatTime(new Date(r.timestamp).toISOString())}</td>
      <td><span class="method-badge method-${r.method}">${r.method}</span></td>
      <td>${r.path}</td>
      <td><span class="status-code ${statusClass(r.statusCode)}">${r.statusCode}</span></td>
      <td>${Math.round(r.durationMs)}ms</td>
      <td>${r.ip || '-'}</td>
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
  el.className = `status-badge ${status}`;
  const labels = {
    connected: 'Ao vivo',
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
  };
  el.querySelector('span:last-child').textContent = labels[status];
}

function connectSSE() {
  setConnectionStatus('connecting');
  const source = new EventSource('/api/metrics/stream');

  source.onmessage = (event) => {
    setConnectionStatus('connected');
    const data = JSON.parse(event.data);
    updateDashboard(data);
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
