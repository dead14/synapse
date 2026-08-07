const test = require('node:test');
const assert = require('node:assert/strict');

// Requiring this module opens the shared producer client immediately, so every
// client this test touches is disconnected again before the suite exits.
const {
    connection,
    commandTimeoutMs,
    createWorkerConnection,
} = require('../src/config/redis');

test.after(() => {
    connection.disconnect();
});

test('command timeout is bounded by default and overridable', () => {
    assert.equal(commandTimeoutMs({}), 10_000);
    assert.equal(commandTimeoutMs({ REDIS_COMMAND_TIMEOUT_MS: '2500' }), 2_500);
    // A zero or unparseable override must not disable the bound: that is the
    // hang this timeout exists to prevent.
    assert.equal(commandTimeoutMs({ REDIS_COMMAND_TIMEOUT_MS: '0' }), 10_000);
    assert.equal(commandTimeoutMs({ REDIS_COMMAND_TIMEOUT_MS: '-1' }), 10_000);
    assert.equal(commandTimeoutMs({ REDIS_COMMAND_TIMEOUT_MS: 'never' }), 10_000);
});

test('the queue producer client cannot wait on Redis forever', () => {
    // Without this, maxRetriesPerRequest: null plus the offline queue meant a
    // queue.add() issued while Redis was unreachable never settled, so an
    // upload hung with no error and the QUEUE_UNAVAILABLE handlers that were
    // written for exactly this case never ran.
    assert.equal(typeof connection.options.commandTimeout, 'number');
    assert.ok(connection.options.commandTimeout > 0);
    assert.equal(connection.options.maxRetriesPerRequest, null);
});

test('worker clients keep blocking forever, which is what consuming a queue needs', () => {
    const worker = createWorkerConnection('test-worker');
    try {
        // A worker parked on an empty queue is supposed to block. Timing that
        // out would tear the consumer down every few seconds while idle.
        assert.equal(worker.options.commandTimeout, undefined);
        assert.equal(worker.options.maxRetriesPerRequest, null);
    } finally {
        worker.disconnect();
    }
});
