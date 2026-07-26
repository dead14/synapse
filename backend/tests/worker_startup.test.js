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

test('queue worker handles are returned so shutdown can close them', () => {
    const returned = startConfiguredWorkers({
        env: {},
        startPythonWorkers: () => {},
        startIngestionWorker: () => ({ name: 'ingestion' }),
        startAlignmentWorker: () => ({ name: 'alignment' }),
        log: () => {},
    });
    assert.deepEqual(returned, [{ name: 'ingestion' }, { name: 'alignment' }]);

    assert.deepEqual(startConfiguredWorkers({
        env: { RUN_WORKERS: 'false' },
        startPythonWorkers: () => {},
        startIngestionWorker: () => ({}),
        startAlignmentWorker: () => ({}),
        log: () => {},
    }), []);
});
