const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isMultiRunSession,
    resolveInspectionRuns,
    resolveReferenceRun,
    resolveStarRunPairs,
} = require('../src/modules/alignment/multiRunIdentity');
const { resolveSessionRunPairs } = require('../src/modules/alignment/runPairIdentity');

const twoRunConfig = {
    summaryData: {
        masterRun: { runId: 30, year: '2026' },
        oldRun: { runId: 10, year: '2012' },
        newRun: { runId: 30, year: '2026' },
        runPairs: [{ oldRun: { runId: 10, year: '2012' }, newRun: { runId: 30, year: '2026' } }],
    },
};

const threeRunConfig = {
    summaryData: {
        masterRun: { runId: 30, year: '2026' },
        oldRun: { runId: 20, year: '2024' },
        newRun: { runId: 30, year: '2026' },
        runPairs: [
            { oldRun: { runId: 10, year: '2012' }, newRun: { runId: 20, year: '2024' } },
            { oldRun: { runId: 20, year: '2024' }, newRun: { runId: 30, year: '2026' } },
        ],
    },
};

test('collects every inspection run once, oldest first', () => {
    assert.deepEqual(
        resolveInspectionRuns(threeRunConfig).map((run) => run.runId),
        [10, 20, 30],
    );
});

test('reads runs from the phylogenetic run slots as well', () => {
    const runs = resolveInspectionRuns({
        summaryData: {
            ancestorRun: { runId: 1, year: '2010' },
            run1: { runId: 2, year: '2015' },
            run2: { runId: 3, year: '2020' },
        },
    });
    assert.deepEqual(runs.map((run) => run.runId), [1, 2, 3]);
});

test('only a session with more than two runs takes the multi-run path', () => {
    assert.equal(isMultiRunSession(twoRunConfig), false);
    assert.equal(isMultiRunSession(threeRunConfig), true);
    assert.equal(isMultiRunSession({}), false);
});

test('the newest run is the reference, and it can be overridden', () => {
    assert.equal(resolveReferenceRun(threeRunConfig)?.runId, 30);
    assert.equal(resolveReferenceRun(threeRunConfig, 10)?.runId, 10);
    // A stored session-level choice is honoured without passing it explicitly.
    assert.equal(resolveReferenceRun({ ...threeRunConfig, referenceRunId: 20 })?.runId, 20);
    // An id outside the session falls back rather than yielding no reference.
    assert.equal(resolveReferenceRun(threeRunConfig, 999)?.runId, 30);
});

test('star anchors the oldest run to the reference where a chain cannot', () => {
    // The property that matters for growth: with a chain the 2012 run reaches
    // 2026 only through 2024, so a sparse or partial 2024 breaks the trail.
    assert.deepEqual(resolveSessionRunPairs(threeRunConfig).map((p) => p.key), ['10->20', '20->30']);
    assert.deepEqual(resolveStarRunPairs(threeRunConfig).map((p) => p.key), ['10->30', '20->30']);
});

test('a two-run session resolves the identical single pair either way', () => {
    // The multi-run layer must be a superset, never a behaviour change, for the
    // sessions that already work today.
    assert.deepEqual(
        resolveStarRunPairs(twoRunConfig).map((p) => p.key),
        resolveSessionRunPairs(twoRunConfig).map((p) => p.key),
    );
});

test('a session with no persisted runs offers no reference and no pairs', () => {
    assert.equal(resolveReferenceRun({}), null);
    assert.deepEqual(resolveStarRunPairs({}), []);
});
