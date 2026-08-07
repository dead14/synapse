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

function commandTimeoutMs(env = process.env) {
  const configured = Number(env.REDIS_COMMAND_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  // Far longer than a healthy Redis ever needs, short enough that a caller
  // waiting on an enqueue gets an answer while the engineer is still watching.
  return 10_000;
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
//
// The command timeout is what makes `queue.add()` answer at all when Redis is
// unreachable.  maxRetriesPerRequest: null plus ioredis' offline queue means a
// command issued while disconnected is buffered and never rejected, so an
// upload sat on `add()` forever: no error, no timeout, no job -- the request
// simply never returned and the uploader spun until the engineer gave up.  It
// also made the QUEUE_UNAVAILABLE handlers in the ingestion and alignment
// controllers unreachable, because the rejection they catch never arrived.
// ioredis arms this timer before the offline-queue branch, so it bounds
// buffered commands too, not just ones already on the wire.
const connection = attachLogging(new Redis({
  ...buildRedisOptions(),
  commandTimeout: commandTimeoutMs(),
}), 'queue');

// BullMQ Workers hold a blocking connection (BRPOPLPUSH) for the lifetime of
// the worker.  Sharing that client with the queues stalls every producer
// command behind the block, so each worker gets its own.
//
// Deliberately without commandTimeout: a worker waiting on an empty queue is
// *supposed* to block indefinitely, and timing that out would tear down the
// consumer every few seconds on an idle queue.
function createWorkerConnection(label = 'worker') {
  return attachLogging(new Redis(buildRedisOptions()), label);
}

// Dedicated connection for the rate-limiter middleware.  Unlike the queue
// clients it must never queue commands while disconnected — a down Redis
// would otherwise stall every API request until reconnect.  Commands fail
// immediately instead (the middleware fails open on any error), the client
// keeps reconnecting in the background, and errors are logged at most once
// per minute rather than once per retry attempt.
let rateLimiterConnection;
function getRateLimiterConnection() {
  if (!rateLimiterConnection) {
    rateLimiterConnection = new Redis({
      ...buildRedisOptions(),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    let lastErrorLogAt = 0;
    rateLimiterConnection.on('error', (err) => {
      const currentTime = Date.now();
      if (currentTime - lastErrorLogAt >= 60_000) {
        lastErrorLogAt = currentTime;
        console.error('Redis rate-limiter error:', err.message);
      }
    });
    rateLimiterConnection.on('connect', () => {
      console.log('Redis rate-limiter connected');
    });
  }
  return rateLimiterConnection;
}

module.exports = {
  connection,
  commandTimeoutMs,
  createWorkerConnection,
  getRateLimiterConnection,
  buildRedisOptions,
};
