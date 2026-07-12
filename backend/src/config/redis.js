const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

// Setup Redis connection
const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
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
