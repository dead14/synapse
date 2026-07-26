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

    if (!queueWorkersEnabled(env)) return;

    startIngestionWorker();
    startAlignmentWorker();
    log(JSON.stringify({ event: 'worker_started', workers: ['ili-ingestion', 'ili-alignment'] }));
}

module.exports = { queueWorkersEnabled, startConfiguredWorkers };
