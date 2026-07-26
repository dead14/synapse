const { startIngestionWorker } = require('./src/workers/ingestionWorker');
const { startAlignmentWorker } = require('./src/modules/alignment/alignmentWorker');

startIngestionWorker();
startAlignmentWorker();
console.log(JSON.stringify({ event: 'worker_started', worker: 'ili-ingestion' }));
