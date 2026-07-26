const { Queue } = require('bullmq');
const { connection } = require('../../config/redis');

const ingestionQueue = new Queue('ili-ingestion', {
    connection,
    defaultJobOptions: {
        attempts: Number(process.env.INGESTION_JOB_ATTEMPTS) || 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
    },
});

module.exports = { ingestionQueue };
