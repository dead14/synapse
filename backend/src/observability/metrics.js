const MAX_SAMPLES_PER_METRIC = 10_000;
const metrics = new Map();

function normalizeLabel(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_.:/-]/g, '_').slice(0, 80);
}

function metricKey(name, labels = {}) {
    const labelPart = Object.entries(labels)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${normalizeLabel(value)}`)
        .join(',');
    return `${name}{${labelPart}}`;
}

function observe(name, durationMs, labels = {}) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const key = metricKey(name, labels);
    const current = metrics.get(key) || { name, labels, count: 0, sum: 0, samples: [] };
    current.count += 1;
    current.sum += durationMs;
    current.samples.push(durationMs);
    if (current.samples.length > MAX_SAMPLES_PER_METRIC) current.samples.shift();
    metrics.set(key, current);
}

function observeDuration(name, startedAt, labels = {}) {
    const started = typeof startedAt === 'bigint' ? Number(startedAt) / 1e6 : startedAt;
    observe(name, performance.now() - started, labels);
}

function percentile(samples, fraction) {
    if (!samples.length) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function snapshot() {
    return [...metrics.values()].map((metric) => ({
        name: metric.name,
        labels: metric.labels,
        count: metric.count,
        averageMs: metric.sum / metric.count,
        p95Ms: percentile(metric.samples, 0.95),
    }));
}

function prometheus() {
    const lines = ['# HELP synapse_operation_count Number of measured operations', '# TYPE synapse_operation_count counter'];
    for (const item of snapshot()) {
        const labels = Object.entries(item.labels).map(([key, value]) => `${key}="${normalizeLabel(value)}"`).join(',');
        const suffix = labels ? `{${labels}}` : '';
        lines.push(`synapse_operation_count${suffix} ${item.count}`);
        lines.push(`synapse_operation_duration_ms{${labels ? `${labels},` : ''}quantile="0.95"} ${item.p95Ms}`);
        lines.push(`synapse_operation_duration_ms_sum${suffix} ${item.averageMs * item.count}`);
    }
    return `${lines.join('\n')}\n`;
}

module.exports = { observe, observeDuration, prometheus, snapshot };
