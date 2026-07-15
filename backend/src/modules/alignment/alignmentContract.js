const COMPARISON_GROUP_ORDER = Object.freeze([
    'gw_locked',
    'gw_unmatched',
    'anomaly_matched',
    'anomaly_only_old',
    'anomaly_only_new',
    'bypassed_old',
    'bypassed_new',
]);

function validationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function validateDtwPayload(payload, {
    maxRecords = Number(process.env.MAX_DTW_RECORDS) || 25_000,
    maxCells = Number(process.env.MAX_DTW_CELLS) || 4_000_000,
} = {}) {
    if (!payload || typeof payload !== 'object'
        || !Array.isArray(payload.oldRun) || !Array.isArray(payload.newRun)) {
        throw validationError(
            'INVALID_ALIGNMENT_PAYLOAD',
            'oldRun and newRun must both be arrays',
        );
    }

    const oldCount = payload.oldRun.length;
    const newCount = payload.newRun.length;
    if (oldCount > maxRecords || newCount > maxRecords || oldCount * newCount > maxCells) {
        throw validationError(
            'DTW_INPUT_TOO_LARGE',
            'Alignment input exceeds the configured processing limit',
        );
    }
}

function normalizeComparisonResult(engineOutput) {
    if (Array.isArray(engineOutput)) {
        return { comparison: engineOutput, groups: null };
    }

    if (!engineOutput || typeof engineOutput !== 'object') {
        throw new TypeError('Alignment engine output must be an array or bucket object');
    }

    const orderedKeys = [
        ...COMPARISON_GROUP_ORDER,
        ...Object.keys(engineOutput)
            .filter((key) => !COMPARISON_GROUP_ORDER.includes(key))
            .sort(),
    ];
    const comparison = orderedKeys.flatMap((key) => (
        Array.isArray(engineOutput[key]) ? engineOutput[key] : []
    ));

    return { comparison, groups: engineOutput };
}

function readMatchStatus(row) {
    return String(
        row?.['Match Status']
        ?? row?.match_status
        ?? row?.status
        ?? '',
    ).trim().toLowerCase();
}

function summarizeComparison(comparison) {
    if (!Array.isArray(comparison)) {
        throw new TypeError('Comparison must be an array');
    }

    const total = comparison.length;
    const matched = comparison.filter((row) => readMatchStatus(row) === 'matched').length;
    const unmatched = total - matched;

    return {
        total,
        matched,
        unmatched,
        matchRate: total ? Number(((matched / total) * 100).toFixed(1)) : 0,
        anomaliesFound: total,
    };
}

module.exports = {
    COMPARISON_GROUP_ORDER,
    normalizeComparisonResult,
    summarizeComparison,
    validateDtwPayload,
};
