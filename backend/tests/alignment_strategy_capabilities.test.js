const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ALIGNMENT_STRATEGY_NOT_AVAILABLE,
    buildRunEndpointRejection,
    getAlignmentStrategyCapability,
    listAlignmentStrategyCapabilities,
} = require('../src/modules/alignment/alignmentStrategyCapabilities');

test('strategy capabilities expose only validated production execution paths', () => {
    const capabilities = listAlignmentStrategyCapabilities();
    const availableIds = capabilities
        .filter((capability) => capability.available)
        .map((capability) => capability.id)
        .sort();

    assert.deepEqual(availableIds, ['dtw_hungarian_onedirection', 'manual', 'phylogenetic']);
    for (const capability of capabilities.filter((item) => item.available)) {
        assert.equal(capability.validated, true);
        assert.equal(capability.executionEndpoint, '/api/ili-results');
    }
});

test('mock-backed strategies remain unavailable while phylogenetic aliases resolve to the validated engine', () => {
    const cases = new Map([
        ['dtw_hungarian', 'dtw_hungarian'],
        ['DTW-Hungarian', 'dtw_hungarian'],
        ['legacy_dtw_hungarian', 'dtw_hungarian'],
        ['dtw_hungarian_legacy', 'dtw_hungarian'],
        ['traditional_hungarian', 'traditional_hungarian'],
        ['traditional-hungarian', 'traditional_hungarian'],
        ['classic_hungarian', 'traditional_hungarian'],
    ]);

    for (const [requested, canonical] of cases) {
        const capability = getAlignmentStrategyCapability(requested);
        assert.equal(capability.id, canonical, requested);
        assert.equal(capability.available, false, requested);
        assert.equal(capability.validated, false, requested);
        assert.equal(capability.reasonCode, 'MOCK_ENGINE_NOT_VALIDATED', requested);
    }

    for (const requested of ['phylogenetic', 'phylogenesis', 'polyginesis', 'polygenesis', 'filogenesis']) {
        const capability = getAlignmentStrategyCapability(requested);
        assert.equal(capability.id, 'phylogenetic', requested);
        assert.equal(capability.available, true, requested);
        assert.equal(capability.validated, true, requested);
        assert.equal(capability.executionEndpoint, '/api/ili-results', requested);
    }
});

test('missing and unknown strategies fail closed', () => {
    assert.equal(getAlignmentStrategyCapability(undefined).id, 'dtw_hungarian');
    assert.equal(getAlignmentStrategyCapability(undefined).available, false);

    const unknown = getAlignmentStrategyCapability('future-experimental-model');
    assert.equal(unknown.id, 'future_experimental_model');
    assert.equal(unknown.available, false);
    assert.equal(unknown.validated, false);
    assert.equal(unknown.reasonCode, 'UNKNOWN_STRATEGY');
});

test('legacy run rejection has a stable machine code and frontend-readable contract', () => {
    const rejection = buildRunEndpointRejection('phylogenetic');

    assert.equal(rejection.code, ALIGNMENT_STRATEGY_NOT_AVAILABLE);
    assert.equal(rejection.strategy, 'phylogenetic');
    assert.match(rejection.error, /not available/i);
    assert.deepEqual(
        rejection.availableStrategies.map((item) => item.id).sort(),
        ['dtw_hungarian_onedirection', 'manual', 'phylogenetic'],
    );
});
