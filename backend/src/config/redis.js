const Redis = require('ioredis');

function buildRedisOptions() {
  const options = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    // BullMQ requires this: it issues blocking commands whose retry budget
    // must not be capped by ioredis.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Reconnect forever with a capped backoff.  Giving up (the previous
    // behaviour after 3 attempts) permanently stops every BullMQ worker on
    // a transient blip, with no error surfaced anywhere.
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
  };

  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }
  if (process.env.REDIS_TLS === 'true') {
    options.tls = {};
  }
  return options;
}

function attachLogging(client, label) {
  client.on('error', (err) => {
    console.error(`Redis ${label} error:`, err.message);
  });
  client.on('connect', () => {
    console.log(`Redis ${label} connected`);
  });
  return client;
}

// Shared connection for Queue producers.  Queues only issue non-blocking
// commands, so they can share one client.
const connection = attachLogging(new Redis(buildRedisOptions()), 'queue');

// BullMQ Workers hold a blocking connection (BRPOPLPUSH) for the lifetime of
// the worker.  Sharing that client with the queues stalls every producer
// command behind the block, so each worker gets its own.
function createWorkerConnection(label = 'worker') {
  return attachLogging(new Redis(buildRedisOptions()), label);
}

module.exports = {
  connection,
  createWorkerConnection,
  buildRedisOptions,
};
