const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

// Setup Redis connection
const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    // Stop retrying after 3 times to prevent infinite reconnect loop
    if (times >= 3) {
      return null;
    }
    return Math.min(times * 50, 2000);
  }
});

connection.on('error', (err) => {
  console.error('Redis connection error:', err);
});

connection.on('connect', () => {
  console.log('Successfully connected to Redis');
});

module.exports = {
  connection
};
