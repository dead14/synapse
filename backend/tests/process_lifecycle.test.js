const test = require('node:test');
const assert = require('node:assert/strict');

const { fatal } = require('../src/config/processLifecycle');

test('fatal startup handling schedules an unconditional process exit', () => {
    const calls = [];
    const processRef = {
        exitCode: 0,
        exit: (code) => calls.push(['exit', code]),
    };
    const timer = { unref: () => calls.push(['unref']) };

    fatal('Server startup failed', new Error('migration failed'), {
        processRef,
        log: (event, error) => calls.push(['log', event, error.message]),
        schedule: (callback, delay) => {
            calls.push(['schedule', delay]);
            callback();
            return timer;
        },
    });

    assert.equal(processRef.exitCode, 1);
    assert.deepEqual(calls, [
        ['log', 'Server startup failed:', 'migration failed'],
        ['schedule', 100],
        ['exit', 1],
        ['unref'],
    ]);
});
