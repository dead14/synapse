const test = require('node:test');
const assert = require('node:assert/strict');

// Environment must be pinned before any module under test loads: the Python
// executable and pool sizes are captured at require time.
process.env.PYTHON_EXECUTABLE = 'definitely-missing-python-interpreter';
process.env.DTW_WORKER_POOL_SIZE = '2';
process.env.TIEIN_WORKER_POOL_SIZE = '1';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.DB_NAME ||= 'test';

const pythonWorkers = require('../src/modules/alignment/pythonWorkers');

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test('a missing interpreter leaves the process alive and the states restarting', async () => {
    pythonWorkers.startPythonWorkers();

    // Spawn 'error' events arrive asynchronously; poll until both engines
    // have observed their failed spawns.
    let states = pythonWorkers.getPythonWorkerStates();
    for (let attempt = 0; attempt < 50; attempt += 1) {
        states = pythonWorkers.getPythonWorkerStates();
        if (states.dtw.consecutiveFailures >= 1 && states.tieIn.consecutiveFailures >= 1) break;
        await wait(100);
    }

    // Reaching this line at all proves the ENOENT did not become an
    // uncaughtException that killed the API process.
    assert.equal(states.dtw.alive, false);
    assert.equal(states.dtw.restarting, true);
    assert.ok(states.dtw.consecutiveFailures >= 1);
    assert.equal(states.dtw.poolSize, 2);
    assert.equal(states.dtw.workers.length, 2);
    assert.equal(states.tieIn.alive, false);
    assert.equal(states.tieIn.restarting, true);
    assert.equal(states.tieIn.poolSize, 1);

    // Requests are rejected with the historical unavailable message instead
    // of hanging while the backoff restart waits.
    await assert.rejects(
        pythonWorkers.runDtwRequest({ oldRun: [], newRun: [] }),
        /DTW worker is not available\. Check the Python runtime and backend logs\./,
    );
    await assert.rejects(
        pythonWorkers.runTieInRequest({ oldRun: [], newRun: [] }),
        /Tie-in worker is not available\. Check the Python runtime and backend logs\./,
    );

    pythonWorkers.stopPythonWorkers();
});

test('the alignment controller re-exports the worker lifecycle unchanged', () => {
    // config/health.js and any other consumer outside alignment/ resolve the
    // worker states through the controller; the re-export must stay the very
    // same functions so that path keeps working.
    const alignmentController = require('../src/modules/alignment/alignmentController');
    assert.equal(alignmentController.startPythonWorkers, pythonWorkers.startPythonWorkers);
    assert.equal(alignmentController.stopPythonWorkers, pythonWorkers.stopPythonWorkers);
    assert.equal(alignmentController.getPythonWorkerStates, pythonWorkers.getPythonWorkerStates);
});
