/**
 * Which matcher runs Phase 2 (anomaly pairing), and which engine script owns it.
 *
 * Phase 1 — the DTW/girth-weld lock — is chosen by the session's `algorithm`
 * and is not affected by anything here. This registry only decides what happens
 * *after* the welds are locked, which is why it is a separate axis: the same
 * `dtw_hungarian_onedirection` run can pair its metal loss by tolerance on one
 * section-set and by evidence on another attempt, without re-locking welds.
 *
 * Registering a matcher means adding it in exactly four places, or the UI and
 * the engine will disagree about what ran:
 *   1. `ANOMALY_MATCHERS` here (engine script + whether it uses gates)
 *   2. `ANOMALY_MATCHERS` in `frontend/src/wizard/matchingRules.ts` (the wizard choice)
 *   3. the engine script itself, with its own `MATCH_METHOD`
 *   4. `MATCH_METHOD_LABELS` in `frontend/src/utils/alignmentDisplay.ts` (how a
 *      result row names the method that produced it)
 */

const DEFAULT_ANOMALY_MATCHER = 'hungarian';

const ANOMALY_MATCHERS = Object.freeze({
    hungarian: Object.freeze({
        id: 'hungarian',
        label: 'Tolerance gates (Hungarian)',
        engineScript: 'src/python_engines/hungarian_engine.py',
        matchMethod: 'HUNGARIAN',
        usesToleranceGates: true,
    }),
    bayesian_drift: Object.freeze({
        id: 'bayesian_drift',
        label: 'Bayesian drift matching',
        engineScript: 'src/python_engines/bayesian_engine.py',
        matchMethod: 'BAYESIAN_DRIFT',
        usesToleranceGates: false,
    }),
});

/**
 * Phase-1 strategies whose Phase 2 this registry governs. `manual` and
 * `phylogenetic` run their own engines end to end, so a matcher choice saved
 * against one of them must be ignored rather than silently redirect the run to
 * a script that cannot read its configuration.
 */
const GATED_PHASE_ONE_STRATEGIES = new Set([
    'dtw_hungarian_onedirection',
    'dtw_hungarian',
    'traditional_hungarian',
]);

function normalizeAnomalyMatcherId(value) {
    if (value == null || String(value).trim() === '') return DEFAULT_ANOMALY_MATCHER;
    const normalized = String(value)
        .trim()
        .toLowerCase()
        .slice(0, 60)
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return ANOMALY_MATCHERS[normalized] ? normalized : DEFAULT_ANOMALY_MATCHER;
}

/** The matcher a session config asks for, falling back to the tolerance gates. */
function resolveAnomalyMatcher(config, algorithm) {
    if (algorithm !== undefined && !GATED_PHASE_ONE_STRATEGIES.has(String(algorithm))) {
        return ANOMALY_MATCHERS[DEFAULT_ANOMALY_MATCHER];
    }
    const requested = config?.ToleranceConfig?.anomaly_matcher;
    return ANOMALY_MATCHERS[normalizeAnomalyMatcherId(requested)];
}

function listAnomalyMatchers() {
    return Object.values(ANOMALY_MATCHERS);
}

module.exports = {
    ANOMALY_MATCHERS,
    DEFAULT_ANOMALY_MATCHER,
    GATED_PHASE_ONE_STRATEGIES,
    listAnomalyMatchers,
    normalizeAnomalyMatcherId,
    resolveAnomalyMatcher,
};
