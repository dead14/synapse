function queueWorkersEnabled(env = process.env) {
    return String(env.RUN_WORKERS ?? 'true').toLowerCase() !== 'false';
}

function startConfiguredWorkers({
    env = process.env,
    startPythonWorkers,
    startIngestionWorker,
    startAlignmentWorker,
    log = console.log,
}) {
    // DTW and tie-in workers are API-owned long-lived subprocesses. They are
    // required even when BullMQ consumers run in a separate service.
    startPythonWorkers();

    if (!queueWorkersEnabled(env)) return [];

    // Returned so shutdown can close the in-process BullMQ consumers and stop
    // them from picking up jobs mid-exit.
    const queueWorkers = [startIngestionWorker(), startAlignmentWorker()];
    log(JSON.stringify({ event: 'worker_started', workers: ['ili-ingestion', 'ili-alignment'] }));
    return queueWorkers;
}

module.exports = { queueWorkersEnabled, startConfiguredWorkers };
