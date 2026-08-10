const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    ANOMALY_MATCHERS,
    DEFAULT_ANOMALY_MATCHER,
    listAnomalyMatchers,
    normalizeAnomalyMatcherId,
    resolveAnomalyMatcher,
} = require('../src/modules/alignment/anomalyMatchers');

test('every registered matcher points at an engine script that exists', () => {
    for (const matcher of listAnomalyMatchers()) {
        const script = path.join(__dirname, '..', matcher.engineScript);
        assert.ok(fs.existsSync(script), `${matcher.id} -> ${matcher.engineScript}`);
    }
});

test('each engine script declares the MATCH_METHOD the registry advertises', () => {
    // The stamp on a result row is how the UI decides which calculation to
    // render. A registry that disagreed with its engine would label a posterior
    // as a cost.
    for (const matcher of listAnomalyMatchers()) {
        const source = fs.readFileSync(path.join(__dirname, '..', matcher.engineScript), 'utf8');
        assert.match(
            source,
            new RegExp(`MATCH_METHOD\\s*=\\s*["']${matcher.matchMethod}["']`),
            `${matcher.engineScript} should declare MATCH_METHOD = ${matcher.matchMethod}`,
        );
    }
});

test('a session that names no matcher keeps the tolerance gates', () => {
    assert.equal(resolveAnomalyMatcher({}).id, DEFAULT_ANOMALY_MATCHER);
    assert.equal(resolveAnomalyMatcher(null).id, DEFAULT_ANOMALY_MATCHER);
    assert.equal(
        resolveAnomalyMatcher({ ToleranceConfig: {} }, 'dtw_hungarian_onedirection').id,
        'hungarian',
    );
});

test('the Bayesian matcher is selected from the tolerance config', () => {
    const matcher = resolveAnomalyMatcher(
        { ToleranceConfig: { anomaly_matcher: 'bayesian_drift' } },
        'dtw_hungarian_onedirection',
    );

    assert.equal(matcher.id, 'bayesian_drift');
    assert.equal(matcher.engineScript, 'src/python_engines/bayesian_engine.py');
    assert.equal(matcher.usesToleranceGates, false);
});

test('an unknown matcher id falls back rather than spawning nothing', () => {
    assert.equal(normalizeAnomalyMatcherId('quantum_vibes'), DEFAULT_ANOMALY_MATCHER);
    assert.equal(
        resolveAnomalyMatcher({ ToleranceConfig: { anomaly_matcher: 'quantum_vibes' } }).id,
        DEFAULT_ANOMALY_MATCHER,
    );
});

test('matcher ids are normalised the way strategy ids are', () => {
    assert.equal(normalizeAnomalyMatcherId('Bayesian Drift'), 'bayesian_drift');
    assert.equal(normalizeAnomalyMatcherId('  bayesian-drift '), 'bayesian_drift');
    assert.equal(normalizeAnomalyMatcherId(''), DEFAULT_ANOMALY_MATCHER);
    assert.equal(normalizeAnomalyMatcherId(undefined), DEFAULT_ANOMALY_MATCHER);
});

test('strategies that own both phases ignore a saved matcher choice', () => {
    // manual and phylogenetic run their own engines end to end; redirecting them
    // to a Phase-2 script would hand a session to an engine that cannot read it.
    for (const algorithm of ['manual', 'phylogenetic']) {
        assert.equal(
            resolveAnomalyMatcher(
                { ToleranceConfig: { anomaly_matcher: 'bayesian_drift' } }, algorithm,
            ).id,
            DEFAULT_ANOMALY_MATCHER,
        );
    }
});

test('the registry is frozen so a caller cannot redirect an engine at runtime', () => {
    // Sloppy mode swallows the write rather than throwing, so the assertion has
    // to be that nothing moved — which is the property that matters anyway.
    ANOMALY_MATCHERS.bayesian_drift.engineScript = 'evil.py';
    assert.equal(
        ANOMALY_MATCHERS.bayesian_drift.engineScript,
        'src/python_engines/bayesian_engine.py',
    );
});
