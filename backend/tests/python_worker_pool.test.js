const test = require('node:test');
const assert = require('node:assert/strict');

const { PersistentJsonWorker } = require('../src/python/persistentJsonWorker');
const { PythonWorkerPool } = require('../src/python/pythonWorkerPool');
const { FakeChildProcess, quietLog, wait } = require('./helpers/fakeChildProcess');

function createPool({ size = 2, queueMax = 2, maxInFlightPerWorker = 1, defaultTimeoutMs = 5_000 } = {}) {
    const children = [];
    let requestCounter = 0;
    const pool = new PythonWorkerPool({
        name: 'Fake',
        size,
        queueMax,
        maxInFlightPerWorker,
        defaultTimeoutMs,
        createWorker: () => new PersistentJsonWorker({
            name: 'Fake',
            command: 'fake-python',
            args: ['engine.py'],
            spawnFn: () => {
                const child = new FakeChildProcess();
                children.push(child);
                return child;
            },
            restartBaseDelayMs: 10,
            restartMaxDelayMs: 20,
            // Shared like the per-engine counter in pythonWorkers.js, so
            // requestIds stay unique across the pool.
            nextRequestId: () => { requestCounter += 1; return requestCounter; },
            log: quietLog,
        }),
    });
    pool.start();
    return { pool, children };
}

function respondToLast(child, extra = {}) {
    child.respond({ requestId: child.stdin.lastRequest().requestId, success: true, ...extra });
}

test('concurrent requests round-robin across the pool', async () => {
    const { pool, children } = createPool({ size: 2 });

    const first = pool.sendRequest({ value: 1 });
    const second = pool.sendRequest({ value: 2 });

    assert.equal(children.length, 2);
    assert.equal(children[0].stdin.writes.length, 1);
    assert.equal(children[1].stdin.writes.length, 1);
    assert.equal(pool.state().pendingRequests, 2);

    respondToLast(children[0], { value: 1 });
    respondToLast(children[1], { value: 2 });
    assert.equal((await first).value, 1);
    assert.equal((await second).value, 2);

    // Both idle again: the cursor keeps rotating instead of favouring the
    // first worker.
    const third = pool.sendRequest({ value: 3 });
    assert.equal(children[0].stdin.writes.length, 2);
    assert.equal(children[1].stdin.writes.length, 1);
    respondToLast(children[0], { value: 3 });
    assert.equal((await third).value, 3);

    pool.stop();
});

test('requests queue at the in-flight cap and drain when a worker frees', async () => {
    const { pool, children } = createPool({ size: 1, queueMax: 5 });

    const first = pool.sendRequest({ value: 1 });
    const second = pool.sendRequest({ value: 2 });

    // The single worker is busy, so the second request waits in the queue.
    assert.equal(children[0].stdin.writes.length, 1);
    assert.equal(pool.state().queuedRequests, 1);

    respondToLast(children[0], { value: 1 });
    assert.equal((await first).value, 1);

    // Settling the first request pumps the queue into the freed worker.
    assert.equal(pool.state().queuedRequests, 0);
    assert.equal(children[0].stdin.writes.length, 2);
    respondToLast(children[0], { value: 2 });
    assert.equal((await second).value, 2);

    pool.stop();
});

test('queue overflow rejects immediately with a typed ENGINE_BUSY error', async () => {
    const { pool, children } = createPool({ size: 1, queueMax: 1 });

    const inFlight = pool.sendRequest({ value: 1 });
    const queued = pool.sendRequest({ value: 2 });
    const overflow = pool.sendRequest({ value: 3 });

    await assert.rejects(overflow, (error) => {
        assert.equal(error.code, 'ENGINE_BUSY');
        assert.match(error.message, /Too many Fake requests in progress\. Retry shortly\./);
        return true;
    });

    // The overflow rejection does not disturb admitted work.
    respondToLast(children[0], { value: 1 });
    assert.equal((await inFlight).value, 1);
    respondToLast(children[0], { value: 2 });
    assert.equal((await queued).value, 2);

    pool.stop();
});

test('a queued request that times out is removed from the queue', async () => {
    const { pool, children } = createPool({ size: 1, queueMax: 5 });

    const inFlight = pool.sendRequest({ value: 1 }, 5_000);
    const queued = pool.sendRequest({ value: 2 }, 15);

    assert.equal(pool.state().queuedRequests, 1);
    await assert.rejects(queued, /Fake Python worker timeout/);
    assert.equal(pool.state().queuedRequests, 0);

    // Freeing the worker must not dispatch the expelled request.
    respondToLast(children[0], { value: 1 });
    assert.equal((await inFlight).value, 1);
    await wait(10);
    assert.equal(children[0].stdin.writes.length, 1);

    pool.stop();
});

test('requests fail fast and queued work flushes when no worker is writable', async () => {
    const { pool, children } = createPool({ size: 1, queueMax: 5 });

    const inFlight = pool.sendRequest({ value: 1 });
    const queued = pool.sendRequest({ value: 2 });

    // The only worker dies: the in-flight request fails with the crash, the
    // queued one is flushed instead of waiting for a restart.
    children[0].emit('close', 1);
    await assert.rejects(inFlight, /Fake Python worker crashed/);
    await assert.rejects(queued, /Fake worker is not available/);
    assert.equal(pool.state().queuedRequests, 0);

    // New requests are rejected immediately while the engine restarts.
    await assert.rejects(pool.sendRequest({ value: 3 }), /Fake worker is not available/);
    assert.equal(pool.state().alive, false);
    assert.equal(pool.state().restarting, true);

    pool.stop();
});

test('a surviving worker keeps serving the queue when its sibling dies', async () => {
    const { pool, children } = createPool({ size: 2, queueMax: 5 });

    const first = pool.sendRequest({ value: 1 });
    const second = pool.sendRequest({ value: 2 });
    const queued = pool.sendRequest({ value: 3 });
    assert.equal(pool.state().queuedRequests, 1);

    children[0].emit('close', 1);
    await assert.rejects(first, /Fake Python worker crashed/);

    // The queue survives because worker 2 is still writable, and drains into
    // it once its in-flight request settles.
    respondToLast(children[1], { value: 2 });
    assert.equal((await second).value, 2);
    assert.equal(children[1].stdin.writes.length, 2);
    respondToLast(children[1], { value: 3 });
    assert.equal((await queued).value, 3);

    pool.stop();
});

test('stop rejects queued work, kills workers, and refuses new requests', async () => {
    const { pool, children } = createPool({ size: 1, queueMax: 5 });

    const inFlight = pool.sendRequest({ value: 1 });
    const queued = pool.sendRequest({ value: 2 });
    pool.stop();

    await assert.rejects(inFlight, /Python workers are shutting down/);
    await assert.rejects(queued, /Python workers are shutting down/);
    assert.equal(children[0].killed, true);
    await assert.rejects(pool.sendRequest({ value: 3 }), /Python workers are shutting down/);
});

test('pool state aggregates member detail for the readiness endpoint', async () => {
    const { pool, children } = createPool({ size: 2, queueMax: 5 });

    const inFlight = pool.sendRequest({ value: 1 });
    const state = pool.state();
    assert.equal(state.alive, true);
    assert.equal(state.restarting, false);
    assert.equal(state.pendingRequests, 1);
    assert.equal(state.queuedRequests, 0);
    assert.equal(state.poolSize, 2);
    assert.equal(state.workers.length, 2);

    // One member dies: the engine reports degraded but keeps per-member truth.
    children[1].emit('close', 1);
    const degraded = pool.state();
    assert.equal(degraded.alive, false);
    assert.equal(degraded.restarting, true);
    assert.equal(degraded.consecutiveFailures, 1);

    respondToLast(children[0], { value: 1 });
    assert.equal((await inFlight).value, 1);
    pool.stop();
});
