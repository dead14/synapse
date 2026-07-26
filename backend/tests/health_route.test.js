const test = require('node:test');
const assert = require('node:assert/strict');
const {
    healthHandler,
    collectReadiness,
    createReadinessHandler,
} = require('../src/config/health');

test('health handler returns the public liveness payload', () => {
    let payload;
    const response = {
        json(value) {
            payload = value;
            return this;
        },
    };

    const returned = healthHandler({}, response);

    assert.equal(returned, response);
    assert.deepEqual(payload, { status: 'ok' });
});

function fakeResponse() {
    return {
        statusCode: null,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.payload = value;
            return this;
        },
    };
}

function aliveWorkers() {
    return {
        dtw: { alive: true, restarting: false, consecutiveFailures: 0, pendingRequests: 0 },
        tieIn: { alive: true, restarting: false, consecutiveFailures: 0, pendingRequests: 0 },
    };
}

test('readiness answers 200 ok with per-check detail when core dependencies are up', async () => {
    const response = fakeResponse();
    await createReadinessHandler({
        pool: { query: async () => ({ rows: [{ '?column?': 1 }] }) },
        redis: { ping: async () => 'PONG' },
        getPythonWorkerStates: aliveWorkers,
        timeoutMs: 200,
    })({}, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, 'ok');
    assert.equal(response.payload.checks.database.status, 'ok');
    assert.equal(response.payload.checks.redis.status, 'ok');
    assert.equal(response.payload.checks.pythonWorkers.status, 'ok');
});

test('readiness degrades to 503 when the database is down', async () => {
    const response = fakeResponse();
    await createReadinessHandler({
        pool: { query: async () => { throw new Error('connection refused'); } },
        redis: { ping: async () => 'PONG' },
        getPythonWorkerStates: aliveWorkers,
        timeoutMs: 200,
    })({}, response);

    assert.equal(response.statusCode, 503);
    assert.equal(response.payload.status, 'degraded');
    assert.equal(response.payload.checks.database.status, 'error');
    assert.match(response.payload.checks.database.error, /connection refused/);
});

test('readiness degrades when a python worker is down and exposes its restart state', async () => {
    const response = fakeResponse();
    await createReadinessHandler({
        pool: { query: async () => ({}) },
        redis: { ping: async () => 'PONG' },
        getPythonWorkerStates: () => ({
            dtw: { alive: false, restarting: true, consecutiveFailures: 3, pendingRequests: 0 },
            tieIn: { alive: true, restarting: false, consecutiveFailures: 0, pendingRequests: 0 },
        }),
        timeoutMs: 200,
    })({}, response);

    assert.equal(response.statusCode, 503);
    assert.equal(response.payload.status, 'degraded');
    assert.equal(response.payload.checks.pythonWorkers.status, 'degraded');
    assert.equal(response.payload.checks.pythonWorkers.dtw.restarting, true);
    assert.equal(response.payload.checks.pythonWorkers.dtw.consecutiveFailures, 3);
});

test('a hung dependency times out instead of hanging the readiness endpoint', async () => {
    const readiness = await collectReadiness({
        pool: { query: () => new Promise(() => {}) },
        redis: { ping: async () => 'PONG' },
        getPythonWorkerStates: aliveWorkers,
        timeoutMs: 20,
    });

    assert.equal(readiness.status, 'degraded');
    assert.equal(readiness.checks.database.status, 'error');
    assert.match(readiness.checks.database.error, /timed out/);
});

test('a missing shared redis connection is skipped without degrading readiness', async () => {
    const readiness = await collectReadiness({
        pool: { query: async () => ({}) },
        redis: null,
        getPythonWorkerStates: aliveWorkers,
        timeoutMs: 200,
    });

    assert.equal(readiness.status, 'ok');
    assert.equal(readiness.checks.redis.status, 'skipped');
});
