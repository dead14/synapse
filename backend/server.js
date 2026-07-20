const app = require('./src/app');
const http = require('http');
const socketConfig = require('./src/socket');
const { ensureDatabaseSchema } = require('./src/config/schema');
const { startIngestionWorker } = require('./src/workers/ingestionWorker');
const { startAlignmentWorker } = require('./src/modules/alignment/alignmentWorker');

const PORT = process.env.PORT || 8000;

async function startServer() {
    await ensureDatabaseSchema();

    // The API queues uploads through BullMQ.  Start the workers with the
    // server by default so a normal `npm start` cannot leave ingestion jobs
    // stuck at 0% when the separate worker process was not launched.
    // Set RUN_WORKERS=false when workers are managed by a separate service.
    if (String(process.env.RUN_WORKERS ?? 'true').toLowerCase() !== 'false') {
        startIngestionWorker();
        startAlignmentWorker();
        console.log(JSON.stringify({ event: 'worker_started', workers: ['ili-ingestion', 'ili-alignment'] }));
    }

    const server = http.createServer(app);
    socketConfig.init(server);

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log('Modular Monolith structure active with WebSocket.');
    });
}

startServer().catch((error) => {
    console.error('Server startup failed:', error.message);
    process.exitCode = 1;
});

module.exports = { startServer };
