const MAX_SAMPLES_PER_METRIC = 1_000;
// Metric series are never evicted, so an unbounded label space is a memory
// leak reachable by anyone who can send requests.  Past this many distinct
// series, further ones collapse into a single overflow bucket.
const MAX_DISTINCT_METRICS = Number(process.env.METRICS_MAX_SERIES) || 500;
const OVERFLOW_LABEL = 'other';

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

    let key = metricKey(name, labels);
    let effectiveLabels = labels;
    if (!metrics.has(key) && metrics.size >= MAX_DISTINCT_METRICS) {
        effectiveLabels = { ...labels, route: OVERFLOW_LABEL };
        key = metricKey(name, effectiveLabels);
    }

    const current = metrics.get(key) || {
        name,
        labels: effectiveLabels,
        count: 0,
        sum: 0,
        // Fixed-capacity ring buffer.  The previous array + shift() was O(n)
        // per observation once it reached capacity.
        samples: new Array(MAX_SAMPLES_PER_METRIC),
        sampleCount: 0,
        sampleCursor: 0,
    };
    current.count += 1;
    current.sum += durationMs;
    current.samples[current.sampleCursor] = durationMs;
    current.sampleCursor = (current.sampleCursor + 1) % MAX_SAMPLES_PER_METRIC;
    if (current.sampleCount < MAX_SAMPLES_PER_METRIC) current.sampleCount += 1;
    metrics.set(key, current);
}

function filledSamples(metric) {
    return metric.samples.slice(0, metric.sampleCount);
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
        p95Ms: percentile(filledSamples(metric), 0.95),
    }));
}

// Test seam: metric state is process-global.
function reset() {
    metrics.clear();
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

module.exports = {
    observe,
    observeDuration,
    prometheus,
    snapshot,
    reset,
    MAX_DISTINCT_METRICS,
    MAX_SAMPLES_PER_METRIC,
};
