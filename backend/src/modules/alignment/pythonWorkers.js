const path = require('path');
const { pythonExecutable, pythonSpawnOptions } = require('../../config/python');
const { PersistentJsonWorker } = require('../../python/persistentJsonWorker');
const { PythonWorkerPool } = require('../../python/pythonWorkerPool');

// Engines are spawned from the backend root so their script paths resolve.
const ENGINE_CWD = path.join(__dirname, '../../..');

const DTW_WORKER_TIMEOUT_MS = Number(process.env.DTW_WORKER_TIMEOUT_MS) || 60_000;
const TIEIN_WORKER_TIMEOUT_MS = Number(process.env.TIEIN_WORKER_TIMEOUT_MS) || 30_000;

// Pool sizing and admission control.  Each engine answers strictly serially,
// so capacity comes from pool size; the bounded queue absorbs short bursts
// and everything beyond it is rejected as ENGINE_BUSY (HTTP 429).
const DTW_WORKER_POOL_SIZE = Number(process.env.DTW_WORKER_POOL_SIZE) || 2;
const TIEIN_WORKER_POOL_SIZE = Number(process.env.TIEIN_WORKER_POOL_SIZE) || 1;
const DTW_QUEUE_MAX = Number(process.env.DTW_QUEUE_MAX) || 20;
const TIEIN_QUEUE_MAX = Number(process.env.TIEIN_QUEUE_MAX) || 20;

// Restart backoff tuning (see PersistentJsonWorker): 1s doubling to a 60s
// cap, with the failure counter reset once a worker proves healthy.
const WORKER_RESTART_BASE_DELAY_MS = Number(process.env.WORKER_RESTART_BASE_DELAY_MS) || 1000;
const WORKER_RESTART_MAX_DELAY_MS = Number(process.env.WORKER_RESTART_MAX_DELAY_MS) || 60_000;
const WORKER_HEALTHY_AFTER_MS = Number(process.env.WORKER_HEALTHY_AFTER_MS) || 60_000;

// One counter per engine, shared by every pool member, so the requestId the
// engine echoes back stays unique per engine exactly as it was when a single
// module-level counter fed a single worker.
function sequentialRequestIds() {
    let counter = 0;
    return () => {
        counter += 1;
        return counter;
    };
}

function createEnginePool({ name, script, size, queueMax, defaultTimeoutMs, messages }) {
    const nextRequestId = sequentialRequestIds();
    return new PythonWorkerPool({
        name,
        size,
        queueMax,
        defaultTimeoutMs,
        maxInFlightPerWorker: 1,
        messages,
        createWorker: () => new PersistentJsonWorker({
            name,
            command: pythonExecutable,
            args: [script],
            spawnOptions: () => pythonSpawnOptions({ cwd: ENGINE_CWD }),
            restartBaseDelayMs: WORKER_RESTART_BASE_DELAY_MS,
            restartMaxDelayMs: WORKER_RESTART_MAX_DELAY_MS,
            healthyAfterMs: WORKER_HEALTHY_AFTER_MS,
            nextRequestId,
            messages,
        }),
    });
}

// Message overrides preserve the exact strings the API surfaced before the
// extraction; handlers pass err.message straight into response bodies.
const dtwPool = createEnginePool({
    name: 'DTW',
    script: 'src/python_engines/dtw_engine.py',
    size: DTW_WORKER_POOL_SIZE,
    queueMax: DTW_QUEUE_MAX,
    defaultTimeoutMs: DTW_WORKER_TIMEOUT_MS,
    messages: {
        unavailable: 'DTW worker is not available. Check the Python runtime and backend logs.',
        timeout: 'Python worker timeout',
        crashed: 'Python worker crashed',
        busy: 'Too many alignment requests in progress. Retry shortly.',
    },
});

const tieInPool = createEnginePool({
    name: 'TieIn',
    script: 'src/python_engines/tiein_engine.py',
    size: TIEIN_WORKER_POOL_SIZE,
    queueMax: TIEIN_QUEUE_MAX,
    defaultTimeoutMs: TIEIN_WORKER_TIMEOUT_MS,
    messages: {
        unavailable: 'Tie-in worker is not available. Check the Python runtime and backend logs.',
        timeout: 'TieIn Python worker timeout',
        crashed: 'TieIn Python worker crashed',
        busy: 'Too many tie-in requests in progress. Retry shortly.',
    },
});

function startPythonWorkers() {
    dtwPool.start();
    tieInPool.start();
}

function stopPythonWorkers() {
    dtwPool.stop();
    tieInPool.stop();
}

process.once('exit', stopPythonWorkers);

// Readiness detail for the health endpoint: state only, never process
// handles.  Consumed via the alignmentController re-export by config/health.
function getPythonWorkerStates() {
    return {
        dtw: dtwPool.state(),
        tieIn: tieInPool.state(),
    };
}

function runDtwRequest(payload) {
    return dtwPool.sendRequest(payload, DTW_WORKER_TIMEOUT_MS);
}

function runTieInRequest(payload) {
    return tieInPool.sendRequest(payload, TIEIN_WORKER_TIMEOUT_MS);
}

module.exports = {
    startPythonWorkers,
    stopPythonWorkers,
    getPythonWorkerStates,
    runDtwRequest,
    runTieInRequest,
};
