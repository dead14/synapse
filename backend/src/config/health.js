// Liveness stays a fixed payload: the deploy gate greps for {status:'ok'} and
// must never be failed by a slow dependency.
function healthHandler(_req, res) {
    return res.json({ status: 'ok' });
}

const READINESS_CHECK_TIMEOUT_MS = Number(process.env.READINESS_CHECK_TIMEOUT_MS) || 2000;

// Dependencies are resolved lazily: requiring the redis module at load time
// would open a live connection for any test that merely imports this file.
function defaultReadinessDependencies() {
    return {
        pool: require('./db'),
        redis: require('./redis').connection,
        getPythonWorkerStates: require('../modules/alignment/alignmentController').getPythonWorkerStates,
    };
}

async function runCheck(label, run, timeoutMs) {
    let timer;
    try {
        await Promise.race([
            run(),
            new Promise((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`${label} check timed out after ${timeoutMs}ms`)),
                    timeoutMs,
                );
                timer.unref?.();
            }),
        ]);
        return { status: 'ok' };
    } catch (error) {
        return { status: 'error', error: error.message };
    } finally {
        clearTimeout(timer);
    }
}

async function collectReadiness({ pool, redis, getPythonWorkerStates, timeoutMs = READINESS_CHECK_TIMEOUT_MS }) {
    const [database, redisCheck] = await Promise.all([
        runCheck('database', () => pool.query('SELECT 1'), timeoutMs),
        redis
            ? runCheck('redis', () => redis.ping(), timeoutMs)
            : Promise.resolve({ status: 'skipped' }),
    ]);

    const workerStates = getPythonWorkerStates ? getPythonWorkerStates() : null;
    const workersReady = !workerStates
        || Object.values(workerStates).every((worker) => worker.alive);
    const pythonWorkers = workerStates
        ? { status: workersReady ? 'ok' : 'degraded', ...workerStates }
        : { status: 'skipped' };

    const healthy = database.status === 'ok'
        && redisCheck.status !== 'error'
        && workersReady;

    return {
        status: healthy ? 'ok' : 'degraded',
        checks: {
            database,
            redis: redisCheck,
            pythonWorkers,
        },
    };
}

function createReadinessHandler(dependencies = null) {
    return async function readinessHandler(_req, res) {
        const resolved = dependencies || defaultReadinessDependencies();
        const readiness = await collectReadiness(resolved);
        return res.status(readiness.status === 'ok' ? 200 : 503).json(readiness);
    };
}

module.exports = { healthHandler, collectReadiness, createReadinessHandler };
