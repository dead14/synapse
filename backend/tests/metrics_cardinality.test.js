const test = require('node:test');
const assert = require('node:assert/strict');

const metrics = require('../src/observability/metrics');

test('metric series are capped so an unauthenticated URL loop cannot leak memory', () => {
    metrics.reset();

    // The metrics middleware runs before auth, so this simulates any client
    // hammering distinct 404 paths.
    for (let index = 0; index < metrics.MAX_DISTINCT_METRICS * 4; index += 1) {
        metrics.observe('http_request', 5, {
            method: 'GET',
            route: `/api/junk-${index}`,
            status: 404,
        });
    }

    const series = metrics.snapshot();
    assert.ok(
        series.length <= metrics.MAX_DISTINCT_METRICS + 1,
        `expected the series count to stay bounded, saw ${series.length}`,
    );

    // Nothing is lost: the excess observations land in the overflow bucket.
    const overflow = series.find((item) => item.labels.route === 'other');
    assert.ok(overflow, 'expected an overflow bucket');
    assert.ok(overflow.count > 0);

    const totalObserved = series.reduce((sum, item) => sum + item.count, 0);
    assert.equal(totalObserved, metrics.MAX_DISTINCT_METRICS * 4);

    metrics.reset();
});

test('samples stay bounded and percentiles remain correct past capacity', () => {
    metrics.reset();

    const capacity = metrics.MAX_SAMPLES_PER_METRIC;
    // Write more than one full lap of the ring buffer, all with the same value
    // so the percentile is predictable regardless of which lap survived.
    for (let index = 0; index < capacity * 2 + 7; index += 1) {
        metrics.observe('ring', 42, { route: '/api/fixed' });
    }

    const [series] = metrics.snapshot();
    assert.equal(series.count, capacity * 2 + 7);
    assert.equal(series.p95Ms, 42);
    assert.equal(series.averageMs, 42);

    metrics.reset();
});

test('percentiles reflect the most recent window', () => {
    metrics.reset();

    const capacity = metrics.MAX_SAMPLES_PER_METRIC;
    // Fill with slow samples, then overwrite the whole buffer with fast ones.
    for (let index = 0; index < capacity; index += 1) {
        metrics.observe('window', 1000, { route: '/api/w' });
    }
    for (let index = 0; index < capacity; index += 1) {
        metrics.observe('window', 1, { route: '/api/w' });
    }

    const [series] = metrics.snapshot();
    assert.equal(series.p95Ms, 1, 'stale slow samples must have been evicted');

    metrics.reset();
});
