const test = require('node:test');
const assert = require('node:assert/strict');

const {
    findSessionRunPair,
    primarySessionRunPair,
    resolveSessionRunPairs,
    runPairKey,
} = require('../src/modules/alignment/runPairIdentity');

const threeRunConfig = {
    summaryData: {
        masterRun: { runId: 30, year: '2024' },
        oldRun: { runId: 20, year: '2021' },
        newRun: { runId: 30, year: '2024' },
        runPairs: [
            { oldRun: { runId: 10, year: '2019' }, newRun: { runId: 20, year: '2021' } },
            { oldRun: { runId: 20, year: '2021' }, newRun: { runId: 30, year: '2024' } },
        ],
    },
};

test('run pair keys match the frontend format exactly', () => {
    assert.equal(runPairKey(10, 20), '10->20');
    assert.equal(runPairKey('10', '20'), '10->20');
    assert.equal(runPairKey(-1, 20), null);
    assert.equal(runPairKey(10, 'abc'), null);
});

test('resolves one pair per chain transition', () => {
    assert.deepEqual(resolveSessionRunPairs(threeRunConfig).map((pair) => pair.key), ['10->20', '20->30']);
});

test('degrades a legacy two-run session to a single pair', () => {
    assert.deepEqual(
        resolveSessionRunPairs({ summaryData: { oldRun: { runId: 4 }, newRun: { runId: 7 } } })
            .map((pair) => pair.key),
        ['4->7'],
    );
});

test('a session with no persisted runs offers no pair to align', () => {
    assert.deepEqual(resolveSessionRunPairs({}), []);
    assert.deepEqual(resolveSessionRunPairs({ summaryData: { oldRun: { runId: 5 }, newRun: { runId: 5 } } }), []);
});

test('only pairs the session actually uploaded can be requested', () => {
    assert.equal(findSessionRunPair(threeRunConfig, { oldRunId: 10, newRunId: 20 })?.key, '10->20');
    // A run id from another session must not become alignable by asking for it.
    assert.equal(findSessionRunPair(threeRunConfig, { oldRunId: 10, newRunId: 999 }), null);
    // The chain has no 2019 → 2024 transition, so the shortcut is not alignable.
    assert.equal(findSessionRunPair(threeRunConfig, { oldRunId: 10, newRunId: 30 }), null);
    assert.equal(findSessionRunPair(threeRunConfig, {}), null);
});

test('the primary pair is the newest transition into the master run', () => {
    assert.equal(primarySessionRunPair(threeRunConfig)?.key, '20->30');
    assert.equal(primarySessionRunPair({}), null);
});
