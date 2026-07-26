const test = require('node:test');
const assert = require('node:assert/strict');

const { startConfiguredWorkers } = require('../src/config/workerStartup');

function harness(runWorkers) {
    const calls = [];
    startConfiguredWorkers({
        env: { RUN_WORKERS: runWorkers },
        startPythonWorkers: () => calls.push('python'),
        startIngestionWorker: () => calls.push('ingestion'),
        startAlignmentWorker: () => calls.push('alignment'),
        log: () => calls.push('log'),
    });
    return calls;
}

test('API-owned Python workers start when queue workers are external', () => {
    assert.deepEqual(harness('false'), ['python']);
});

test('default server mode starts Python and queue workers', () => {
    assert.deepEqual(harness(undefined), ['python', 'ingestion', 'alignment', 'log']);
});
