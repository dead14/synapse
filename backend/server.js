const app = require('./src/app');
const http = require('http');
const socketConfig = require('./src/socket');
const { ensureDatabaseSchema } = require('./src/config/schema');
const { startIngestionWorker } = require('./src/workers/ingestionWorker');
const { startAlignmentWorker } = require('./src/modules/alignment/alignmentWorker');
const { startPythonWorkers } = require('./src/modules/alignment/alignmentController');
const { startConfiguredWorkers } = require('./src/config/workerStartup');
const { fatal } = require('./src/config/processLifecycle');

const PORT = process.env.PORT || 8000;

async function startServer() {
    await ensureDatabaseSchema();

    // BullMQ consumers can run in a separate service, while the API-owned DTW
    // and tie-in subprocesses must remain available for request execution.
    startConfiguredWorkers({
        env: process.env,
        startPythonWorkers,
        startIngestionWorker,
        startAlignmentWorker,
    });

    const server = http.createServer(app);
    socketConfig.init(server);

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
