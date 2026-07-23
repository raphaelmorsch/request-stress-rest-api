const WINDOW_MS = 60_000;
const BUCKET_MS = 1_000;

class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.activeConnections = 0;
    this.endpointStats = new Map();
    this.statusCodes = new Map();
    this.latencyBuckets = [];
    this.rpsHistory = [];
    this.latencyHistory = [];
    this.errorHistory = [];
    this.recentRequests = [];
    this.maxRecent = 100;
  }

  recordRequest({ method, path, statusCode, durationMs, ip }) {
    this.totalRequests++;
    if (statusCode >= 400) this.totalErrors++;

    const key = `${method} ${path}`;
    if (!this.endpointStats.has(key)) {
      this.endpointStats.set(key, {
        method,
        path,
        count: 0,
        totalDuration: 0,
        errors: 0,
        minDuration: Infinity,
        maxDuration: 0,
      });
    }
    const stat = this.endpointStats.get(key);
    stat.count++;
    stat.totalDuration += durationMs;
    stat.minDuration = Math.min(stat.minDuration, durationMs);
    stat.maxDuration = Math.max(stat.maxDuration, durationMs);
    if (statusCode >= 400) stat.errors++;

    const codeKey = String(statusCode);
    this.statusCodes.set(codeKey, (this.statusCodes.get(codeKey) || 0) + 1);

    const now = Date.now();
    this.latencyBuckets.push({ ts: now, durationMs });
    this._pruneBuckets(now);

    this.recentRequests.unshift({
      method,
      path,
      statusCode,
      durationMs,
      ip,
      timestamp: now,
    });
    if (this.recentRequests.length > this.maxRecent) {
      this.recentRequests.pop();
    }

    this._updateHistory(now);
  }

  connectionOpened() {
    this.activeConnections++;
  }

  connectionClosed() {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  _pruneBuckets(now) {
    const cutoff = now - WINDOW_MS;
    while (this.latencyBuckets.length && this.latencyBuckets[0].ts < cutoff) {
      this.latencyBuckets.shift();
    }
  }

  _updateHistory(now) {
    const bucketStart = now - (now % BUCKET_MS);
    const lastRps = this.rpsHistory[this.rpsHistory.length - 1];
    if (!lastRps || lastRps.ts !== bucketStart) {
      this.rpsHistory.push({ ts: bucketStart, count: 1 });
    } else {
      lastRps.count++;
    }
    if (this.rpsHistory.length > 120) this.rpsHistory.shift();

    const recent = this.latencyBuckets.filter((b) => b.ts >= now - BUCKET_MS);
    const avgLatency =
      recent.length > 0
        ? recent.reduce((s, b) => s + b.durationMs, 0) / recent.length
        : 0;

    const lastLatency = this.latencyHistory[this.latencyHistory.length - 1];
    if (!lastLatency || lastLatency.ts !== bucketStart) {
      this.latencyHistory.push({ ts: bucketStart, avg: avgLatency });
    } else {
      lastLatency.avg = avgLatency;
    }
    if (this.latencyHistory.length > 120) this.latencyHistory.shift();

    const errorsInBucket = this.recentRequests.filter(
      (r) => r.timestamp >= bucketStart && r.statusCode >= 400
    ).length;
    const lastError = this.errorHistory[this.errorHistory.length - 1];
    if (!lastError || lastError.ts !== bucketStart) {
      this.errorHistory.push({ ts: bucketStart, count: errorsInBucket });
    } else {
      lastError.count = errorsInBucket;
    }
    if (this.errorHistory.length > 120) this.errorHistory.shift();
  }

  _percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getSnapshot() {
    const now = Date.now();
    this._pruneBuckets(now);

    const durations = this.latencyBuckets.map((b) => b.durationMs);
    const windowRequests = this.latencyBuckets.length;
    const rps = windowRequests / (WINDOW_MS / 1000);

    const topEndpoints = [...this.endpointStats.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((e) => ({
        method: e.method,
        path: e.path,
        count: e.count,
        avgDuration: Math.round(e.totalDuration / e.count),
        minDuration: e.minDuration === Infinity ? 0 : Math.round(e.minDuration),
        maxDuration: Math.round(e.maxDuration),
        errorRate: e.count > 0 ? ((e.errors / e.count) * 100).toFixed(1) : '0.0',
      }));

    const statusDistribution = [...this.statusCodes.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);

    return {
      uptime: now - this.startTime,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorRate:
        this.totalRequests > 0
          ? ((this.totalErrors / this.totalRequests) * 100).toFixed(2)
          : '0.00',
      activeConnections: this.activeConnections,
      currentRps: rps.toFixed(1),
      windowRequests,
      latency: {
        avg: durations.length
          ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
          : 0,
        min: durations.length ? Math.round(Math.min(...durations)) : 0,
        max: durations.length ? Math.round(Math.max(...durations)) : 0,
        p50: Math.round(this._percentile(durations, 50)),
        p95: Math.round(this._percentile(durations, 95)),
        p99: Math.round(this._percentile(durations, 99)),
      },
      topEndpoints,
      statusDistribution,
      rpsHistory: this.rpsHistory.map((b) => ({
        time: new Date(b.ts).toISOString(),
        rps: b.count,
      })),
      latencyHistory: this.latencyHistory.map((b) => ({
        time: new Date(b.ts).toISOString(),
        avg: Math.round(b.avg),
      })),
      errorHistory: this.errorHistory.map((b) => ({
        time: new Date(b.ts).toISOString(),
        errors: b.count,
      })),
      recentRequests: this.recentRequests.slice(0, 20),
    };
  }

  reset() {
    this.startTime = Date.now();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.endpointStats.clear();
    this.statusCodes.clear();
    this.latencyBuckets = [];
    this.rpsHistory = [];
    this.latencyHistory = [];
    this.errorHistory = [];
    this.recentRequests = [];
  }

  /** Exposition format for Prometheus / OpenShift User Workload Monitoring. */
  toPrometheus(extraLabels = {}) {
    const now = Date.now();
    this._pruneBuckets(now);

    const labels = (extra = {}) => {
      const all = { ...extraLabels, ...extra };
      const entries = Object.entries(all);
      if (!entries.length) return '';
      return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
    };

    const out = [];

    out.push('# HELP http_requests_total Total HTTP requests handled by the app');
    out.push('# TYPE http_requests_total counter');
    if (this.statusCodes.size === 0) {
      out.push(`http_requests_total${labels({ code: '0' })} 0`);
    } else {
      for (const [code, count] of this.statusCodes.entries()) {
        out.push(`http_requests_total${labels({ code })} ${count}`);
      }
    }

    out.push('# HELP http_requests_errors_total Total HTTP requests with status >= 400');
    out.push('# TYPE http_requests_errors_total counter');
    out.push(`http_requests_errors_total${labels()} ${this.totalErrors}`);

    const durations = this.latencyBuckets.map((b) => b.durationMs);
    const avgLatency =
      durations.length > 0
        ? durations.reduce((s, d) => s + d, 0) / durations.length
        : 0;

    out.push('# HELP http_request_duration_ms_avg Average request duration over the last 60s (ms)');
    out.push('# TYPE http_request_duration_ms_avg gauge');
    out.push(`http_request_duration_ms_avg${labels()} ${avgLatency.toFixed(3)}`);

    const mem = process.memoryUsage();
    out.push('# HELP process_resident_memory_bytes Resident memory size in bytes');
    out.push('# TYPE process_resident_memory_bytes gauge');
    out.push(`process_resident_memory_bytes${labels()} ${mem.rss}`);

    out.push('# HELP process_heap_bytes Node.js heap used in bytes');
    out.push('# TYPE process_heap_bytes gauge');
    out.push(`process_heap_bytes${labels()} ${mem.heapUsed}`);

    out.push('# HELP app_active_connections Current in-flight HTTP requests');
    out.push('# TYPE app_active_connections gauge');
    out.push(`app_active_connections${labels()} ${this.activeConnections}`);

    out.push('# HELP app_uptime_seconds Process uptime in seconds');
    out.push('# TYPE app_uptime_seconds gauge');
    out.push(`app_uptime_seconds${labels()} ${((now - this.startTime) / 1000).toFixed(0)}`);

    return `${out.join('\n')}\n`;
  }
}

module.exports = new MetricsCollector();
