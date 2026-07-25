const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.DB_NAME ||= 'test';

const alignmentRepository = require('../src/modules/alignment/alignmentRepository');

const spawnCalls = [];
let sessionLookupCount = 0;

function createFakePythonProcess() {
    const processHandle = new EventEmitter();
    processHandle.stdout = new EventEmitter();
    processHandle.stderr = new EventEmitter();
    processHandle.stdin = { writable: true, write() {} };
    processHandle.killed = false;
    processHandle.kill = () => {
        processHandle.killed = true;
    };
    return processHandle;
}

const originalSpawn = childProcess.spawn;
const originalFindOwnedSession = alignmentRepository.findOwnedSession;

childProcess.spawn = (...args) => {
    spawnCalls.push(args);
    return createFakePythonProcess();
};
alignmentRepository.findOwnedSession = async () => {
    sessionLookupCount += 1;
    return { id: 42 };
};

const alignmentController = require('../src/modules/alignment/alignmentController');

childProcess.spawn = originalSpawn;
alignmentRepository.findOwnedSession = originalFindOwnedSession;
spawnCalls.length = 0;

function createResponseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

test('legacy run endpoint rejects every mock route before lookup, job creation, or spawn', async () => {
    const cases = [
        ['traditional_hungarian', 'traditional_hungarian'],
        ['dtw_hungarian', 'dtw_hungarian'],
        [undefined, 'dtw_hungarian'],
        ['future-experimental-model', 'future_experimental_model'],
        ['manual', 'manual'],
        ['dtw_hungarian_onedirection', 'dtw_hungarian_onedirection'],
    ];

    sessionLookupCount = 0;
    spawnCalls.length = 0;

    for (const [algorithm, expectedStrategy] of cases) {
        const response = createResponseRecorder();
        await alignmentController.runAlignment({
            body: { runId: 42, algorithm },
            user: { id: 7, orgId: 9 },
        }, response);

        assert.equal(response.statusCode, 422, String(algorithm));
        assert.equal(response.body.code, 'ALIGNMENT_STRATEGY_NOT_AVAILABLE');
        assert.equal(response.body.strategy, expectedStrategy);
        assert.match(response.body.error, /not available/i);
        if (!['manual', 'dtw_hungarian_onedirection'].includes(expectedStrategy)) {
            assert.match(response.body.error, /not validated/i);
        }
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(sessionLookupCount, 0);
    assert.equal(spawnCalls.length, 0);
});
