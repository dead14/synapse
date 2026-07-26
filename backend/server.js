const app = require('./src/app');
const http = require('http');
const socketConfig = require('./src/socket');
const pool = require('./src/config/db');
const { ensureDatabaseSchema } = require('./src/config/schema');
const { startIngestionWorker } = require('./src/workers/ingestionWorker');
const { startAlignmentWorker } = require('./src/modules/alignment/alignmentWorker');
const { startPythonWorkers, stopPythonWorkers } = require('./src/modules/alignment/pythonWorkers');
const { startConfiguredWorkers } = require('./src/config/workerStartup');
const { fatal } = require('./src/config/processLifecycle');

const PORT = process.env.PORT || 8000;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;

// 'exit' listeners cannot await anything, so SIGTERM/SIGINT get their own
// handlers: stop accepting connections, drain the in-process BullMQ workers,
// stop the Python subprocesses, and end the pg pool — with a hard-kill
// fallback so a stuck dependency cannot wedge shutdown forever.
function registerGracefulShutdown({ server, queueWorkers }) {
    let shuttingDown = false;

    const shutdown = async (signal) => {
        // A second signal means "stop waiting": exit immediately.
        if (shuttingDown) process.exit(1);
        shuttingDown = true;
        console.log(`${signal} received, shutting down gracefully...`);

        const hardKill = setTimeout(() => {
            console.error('Graceful shutdown timed out; forcing exit.');
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        hardKill.unref();

        try {
            await new Promise((resolve) => {
                server.close(() => resolve());
                // Websockets and keep-alive sockets otherwise keep close()
                // pending until the hard-kill timer fires.
                socketConfig.getIO()?.close?.();
                server.closeIdleConnections?.();
            });
            await Promise.allSettled(queueWorkers.map(
                (worker) => (typeof worker?.close === 'function' ? worker.close() : null),
            ));
            stopPythonWorkers();
            await pool.end();
            process.exit(0);
        } catch (error) {
            console.error('Graceful shutdown failed:', error);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => { shutdown('SIGTERM'); });
    process.on('SIGINT', () => { shutdown('SIGINT'); });
}

async function startServer() {
    await ensureDatabaseSchema();

    // BullMQ consumers can run in a separate service, while the API-owned DTW
    // and tie-in subprocesses must remain available for request execution.
    const queueWorkers = startConfiguredWorkers({
        env: process.env,
        startPythonWorkers,
        startIngestionWorker,
        startAlignmentWorker,
    }) || [];

    const server = http.createServer(app);
    socketConfig.init(server);

    registerGracefulShutdown({ server, queueWorkers });

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log('Modular Monolith structure active with WebSocket.');
    });
}

// After an uncaught exception the process state is undefined: half-committed
// transactions, leaked pool clients, and — because the BullMQ workers run
// in-process — a poisoned worker that keeps consuming jobs.  Log and let the
// supervisor restart us rather than serving from a corrupt process.
process.on('uncaughtException', (err) => fatal('UNCAUGHT EXCEPTION', err));
process.on('unhandledRejection', (reason) => fatal('UNHANDLED REJECTION', reason));

startServer().catch((error) => {
    fatal('Server startup failed', error);
});

module.exports = { startServer };
