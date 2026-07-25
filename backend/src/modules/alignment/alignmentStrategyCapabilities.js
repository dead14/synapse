const ALIGNMENT_STRATEGY_NOT_AVAILABLE = 'ALIGNMENT_STRATEGY_NOT_AVAILABLE';
const DEFAULT_LEGACY_STRATEGY = 'dtw_hungarian';

function freezeCapability(capability) {
    return Object.freeze(capability);
}

const ALIGNMENT_STRATEGY_CAPABILITIES = Object.freeze({
    dtw_hungarian_onedirection: freezeCapability({
        id: 'dtw_hungarian_onedirection',
        available: true,
        validated: true,
        executionEndpoint: '/api/ili-results',
        executionMethod: 'GET',
        reasonCode: null,
    }),
    manual: freezeCapability({
        id: 'manual',
        available: true,
        validated: true,
        executionEndpoint: '/api/ili-results',
        executionMethod: 'GET',
        reasonCode: null,
    }),
    dtw_hungarian: freezeCapability({
        id: 'dtw_hungarian',
        available: false,
        validated: false,
        executionEndpoint: null,
        executionMethod: null,
        reasonCode: 'MOCK_ENGINE_NOT_VALIDATED',
    }),
    traditional_hungarian: freezeCapability({
        id: 'traditional_hungarian',
        available: false,
        validated: false,
        executionEndpoint: null,
        executionMethod: null,
        reasonCode: 'MOCK_ENGINE_NOT_VALIDATED',
    }),
    phylogenetic: freezeCapability({
        id: 'phylogenetic',
        available: true,
        validated: true,
        executionEndpoint: '/api/ili-results',
        executionMethod: 'GET',
        reasonCode: null,
    }),
});

const STRATEGY_ALIASES = Object.freeze({
    legacy_dtw_hungarian: 'dtw_hungarian',
    dtw_hungarian_legacy: 'dtw_hungarian',
    hungarian_legacy: 'dtw_hungarian',
    traditional: 'traditional_hungarian',
    classic_hungarian: 'traditional_hungarian',
    phylogenetics: 'phylogenetic',
    phylogenesis: 'phylogenetic',
    phylogenetic_alignment: 'phylogenetic',
    polyginesis: 'phylogenetic',
    polygenesis: 'phylogenetic',
    filogenesis: 'phylogenetic',
});

function normalizeStrategyId(value) {
    if (value == null || String(value).trim() === '') return DEFAULT_LEGACY_STRATEGY;
    if (typeof value !== 'string') return 'invalid_strategy';

    const normalized = value
        .trim()
        .toLowerCase()
        .slice(0, 120)
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    return normalized || 'invalid_strategy';
}

function getAlignmentStrategyCapability(value) {
    const requestedId = normalizeStrategyId(value);
    const canonicalId = STRATEGY_ALIASES[requestedId] || requestedId;
    const knownCapability = ALIGNMENT_STRATEGY_CAPABILITIES[canonicalId];
    if (knownCapability) return knownCapability;

    return freezeCapability({
        id: canonicalId,
        available: false,
        validated: false,
        executionEndpoint: null,
        executionMethod: null,
        reasonCode: 'UNKNOWN_STRATEGY',
    });
}

function listAlignmentStrategyCapabilities() {
    return Object.values(ALIGNMENT_STRATEGY_CAPABILITIES);
}

function buildRunEndpointRejection(value) {
    const capability = getAlignmentStrategyCapability(value);
    const error = capability.validated
        ? `Alignment strategy "${capability.id}" is not available through the legacy /api/run endpoint; use ${capability.executionEndpoint}.`
        : `Alignment strategy "${capability.id}" is not validated and is not available for execution.`;

    return {
        error,
        code: ALIGNMENT_STRATEGY_NOT_AVAILABLE,
        strategy: capability.id,
        capability,
        availableStrategies: listAlignmentStrategyCapabilities().filter((item) => item.available),
    };
}

module.exports = {
    ALIGNMENT_STRATEGY_CAPABILITIES,
    ALIGNMENT_STRATEGY_NOT_AVAILABLE,
    buildRunEndpointRejection,
    getAlignmentStrategyCapability,
    listAlignmentStrategyCapabilities,
    normalizeStrategyId,
};
