const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.DB_NAME ||= 'test';

const { __testables } = require('../src/modules/alignment/alignmentWorker');

test('multi-pair worker derives a chronological fallback pair from legacy session data', () => {
    assert.deepEqual(__testables.resolveRunPairs({
        summaryData: {
            oldRun: { runId: 10, year: 2021 },
            newRun: { runId: 11, year: 2024 },
        },
    }), [{
        oldRun: { runId: 10, year: 2021 },
        newRun: { runId: 11, year: 2024 },
    }]);
});

test('multi-pair worker creates an isolated temporary pair configuration', () => {
    const sessionConfig = {
        summaryData: {
            oldRun: { runId: 1 },
            newRun: { runId: 3 },
            historicalRuns: [{ runId: 1 }, { runId: 2 }],
            runPairs: [
                { oldRun: { runId: 1 }, newRun: { runId: 2 } },
                { oldRun: { runId: 2 }, newRun: { runId: 3 } },
            ],
        },
    };

    const pairConfig = __testables.buildPairSessionConfig(sessionConfig, {
        oldRun: { runId: 2, year: 2023 },
        newRun: { runId: 3, year: 2024 },
    });

    assert.deepEqual(pairConfig.summaryData.oldRun, { runId: 2, year: 2023 });
    assert.deepEqual(pairConfig.summaryData.newRun, { runId: 3, year: 2024 });
    assert.deepEqual(pairConfig.summaryData.masterRun, { runId: 3, year: 2024 });
    assert.deepEqual(pairConfig.summaryData.historicalRuns, [{ runId: 2, year: 2023 }]);
    assert.equal('runPairs' in pairConfig.summaryData, false);
    assert.equal(sessionConfig.summaryData.runPairs.length, 2);
});

test('multi-pair worker keeps every result traceable to its source pair', () => {
    const merged = __testables.mergeMultiPairResults([
        { anomaly_matched: [{ id: 'first' }], audit: { matched: 1 } },
        { anomaly_only_new: [{ id: 'second' }], audit: { onlyNew: 1 } },
    ]);

    assert.deepEqual(merged.anomaly_matched, [{ id: 'first', pair_index: 0 }]);
    assert.deepEqual(merged.anomaly_only_new, [{ id: 'second', pair_index: 1 }]);
    assert.deepEqual(merged.audit.pairs, [{ matched: 1 }, { onlyNew: 1 }]);
});

test('merged rows name their run pair so a report can be read', () => {
    // A bare pair_index cannot be interpreted by anyone reading the results.
    const merged = __testables.mergeMultiPairResults(
        [{ anomaly_matched: [{ id: 'first' }] }],
        [{ oldRun: { runId: 10, year: '2012' }, newRun: { runId: 20, year: '2024' } }],
    );

    assert.deepEqual(merged.anomaly_matched, [{
        id: 'first',
        pair_index: 0,
        pair_key: '10->20',
        pair_label: '2012 → 2024',
        pair_old_year: '2012',
        pair_new_year: '2024',
    }]);
});

test('each pair runs on its own tie-in transform, locks and sections', () => {
    // Reusing the unscoped fields for every pair applied the last pair's
    // transform to all of them, displacing whole runs by another pair's offset.
    const sessionConfig = {
        globalOffset: 999,
        tieInTransform: { knots: ['primary'] },
        gwMatchesFinal: [{ old_id: 'primary' }],
        matchingSections: [
            { id: 'older-section', pairKey: '1->2' },
            { id: 'newer-section', pairKey: '2->3' },
        ],
        pairTieIns: {
            '1->2': { globalOffset: 120, tieInTransform: { knots: ['older'] } },
        },
        pairGwResults: {
            '1->2': { gwMatchesFinal: [{ old_id: 'older' }], ota: 2.5 },
        },
        summaryData: {
            oldRun: { runId: 2 },
            newRun: { runId: 3 },
            runPairs: [
                { oldRun: { runId: 1 }, newRun: { runId: 2 } },
                { oldRun: { runId: 2 }, newRun: { runId: 3 } },
            ],
        },
    };

    const pairConfig = __testables.buildPairSessionConfig(sessionConfig, {
        oldRun: { runId: 1, year: '2012' },
        newRun: { runId: 2, year: '2024' },
    });

    assert.equal(pairConfig.globalOffset, 120);
    assert.deepEqual(pairConfig.tieInTransform, { knots: ['older'] });
    assert.deepEqual(pairConfig.gwMatchesFinal, [{ old_id: 'older' }]);
    assert.equal(pairConfig.ota, 2.5);
    assert.deepEqual(pairConfig.matchingSections.map((s) => s.id), ['older-section']);
    assert.equal(pairConfig.activeRunPairKey, '1->2');
    // The shared session configuration must survive untouched.
    assert.equal(sessionConfig.globalOffset, 999);
    assert.equal(sessionConfig.matchingSections.length, 2);
});

test('each pair may carry its own anomaly tolerances', () => {
    // A 14-year interval and a 2-year interval do not deserve the same gates,
    // and a shared ToleranceConfig silently applied one run's judgement to both.
    const sessionConfig = {
        ToleranceConfig: { clock_tolerance: 15, length_tolerance: 50 },
        pairToleranceConfigs: {
            '1->2': { clock_tolerance: 30, length_tolerance: 120 },
        },
        summaryData: {
            oldRun: { runId: 2 },
            newRun: { runId: 3 },
            runPairs: [
                { oldRun: { runId: 1 }, newRun: { runId: 2 } },
                { oldRun: { runId: 2 }, newRun: { runId: 3 } },
            ],
        },
    };

    const wide = __testables.buildPairSessionConfig(sessionConfig, {
        oldRun: { runId: 1 }, newRun: { runId: 2 },
    });
    assert.deepEqual(wide.ToleranceConfig, { clock_tolerance: 30, length_tolerance: 120 });

    // A pair with no override keeps the session-wide configuration.
    const untouched = __testables.buildPairSessionConfig(sessionConfig, {
        oldRun: { runId: 2 }, newRun: { runId: 3 },
    });
    assert.deepEqual(untouched.ToleranceConfig, { clock_tolerance: 15, length_tolerance: 50 });
});

test('an end-to-end strategy cannot be redirected by a saved matcher choice', () => {
    const { ANOMALY_MATCHERS } = require('../src/modules/alignment/anomalyMatchers');
    const bayesian = ANOMALY_MATCHERS.bayesian_drift;

    // manual, phylogenetic and aurora_ili lock the welds and pair the anomalies
    // in one engine. Honouring a matcher choice for them would hand the run to
    // a script that cannot read its configuration, and the result would look
    // perfectly plausible while coming from the wrong algorithm.
    for (const [algorithm, script] of Object.entries({
        manual: 'src/python_engines/manual_alignment_engine.py',
        phylogenetic: 'src/python_engines/phylogenetic_engine.py',
        aurora_ili: 'src/python_engines/aurora_engine.py',
    })) {
        assert.equal(__testables.resolveEngineScript(algorithm, null), script, algorithm);
        assert.equal(__testables.resolveEngineScript(algorithm, bayesian), script, algorithm);
    }
});

test('a girth-weld strategy runs whichever anomaly matcher was chosen', () => {
    const { ANOMALY_MATCHERS } = require('../src/modules/alignment/anomalyMatchers');

    assert.equal(
        __testables.resolveEngineScript('dtw_hungarian_onedirection', ANOMALY_MATCHERS.bayesian_drift),
        'src/python_engines/bayesian_engine.py',
    );
    assert.equal(
        __testables.resolveEngineScript('dtw_hungarian_onedirection', ANOMALY_MATCHERS.hungarian),
        'src/python_engines/hungarian_engine.py',
    );
    // No matcher resolved at all still runs Phase 2, on the tolerance gates.
    assert.equal(
        __testables.resolveEngineScript('dtw_hungarian_onedirection', null),
        'src/python_engines/hungarian_engine.py',
    );
});
