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

function gwPairKey(pair) {
    const oldId = pair?.old_id ?? pair?.oldId;
    const newId = pair?.new_id ?? pair?.newId;
    const oldDistance = Number(pair?.old_odometer ?? pair?.oldVal ?? pair?.oldDist);
    const newDistance = Number(pair?.new_odometer ?? pair?.newVal ?? pair?.newDist);
    return `${oldId}::${newId}::${oldDistance.toFixed(6)}::${newDistance.toFixed(6)}`;
}

function validateMatchingSections(config, { maxSections = 500 } = {}) {
    const sections = config?.matchingSections;
    if (sections == null || (Array.isArray(sections) && sections.length === 0)) return;
    if (!Array.isArray(sections) || sections.length > maxSections) {
        throw validationError(
            'INVALID_MATCHING_SECTIONS',
            `matchingSections must be an array with at most ${maxSections} items`,
        );
    }

    const lockedPairs = Array.isArray(config?.gwMatchesFinal)
        ? [...config.gwMatchesFinal].sort(
            (left, right) => Number(left.new_odometer) - Number(right.new_odometer),
        )
        : [];
    for (let index = 1; index < lockedPairs.length; index += 1) {
        const previous = lockedPairs[index - 1];
        const current = lockedPairs[index];
        if (Number(current.new_odometer) <= Number(previous.new_odometer)
            || Number(current.old_odometer) <= Number(previous.old_odometer)) {
            throw validationError(
                'INVALID_MATCHING_SECTIONS',
                'Locked GW pairs must increase strictly on both OLD and NEW',
            );
        }
    }
    const lockedIndexes = new Map(lockedPairs.map((pair, index) => [gwPairKey(pair), index]));
    const compiled = [];
    const validPolicies = new Set(['MATCH', 'BYPASS', 'REVIEW']);

    for (const [sectionIndex, section] of sections.entries()) {
        const startIndex = lockedIndexes.get(String(section?.startGwKey ?? ''));
        const endIndex = lockedIndexes.get(String(section?.endGwKey ?? ''));
        const policy = String(section?.policy ?? 'MATCH').toUpperCase();
        if (!String(section?.name ?? '').trim()) {
            throw validationError('INVALID_MATCHING_SECTIONS', `Section ${sectionIndex + 1} requires a name`);
        }
        if (startIndex === undefined || endIndex === undefined) {
            throw validationError(
                'INVALID_MATCHING_SECTIONS',
                `Section ${sectionIndex + 1} must use locked GW boundaries`,
            );
        }
        if (startIndex >= endIndex) {
            throw validationError(
                'INVALID_MATCHING_SECTIONS',
                `Section ${sectionIndex + 1} must end downstream on NEW`,
            );
        }
        if (!validPolicies.has(policy)) {
            throw validationError(
                'INVALID_MATCHING_SECTIONS',
                `Section ${sectionIndex + 1} has an invalid policy`,
            );
        }
        if (section?.tolerances != null) {
            if (!section.tolerances || typeof section.tolerances !== 'object' || Array.isArray(section.tolerances)) {
                throw validationError('INVALID_MATCHING_SECTIONS', `Section ${sectionIndex + 1} has invalid tolerances`);
            }
            for (const [key, value] of Object.entries(section.tolerances)) {
                if (!Number.isFinite(Number(value)) || Number(value) < 0) {
                    throw validationError(
                        'INVALID_MATCHING_SECTIONS',
                        `Section ${sectionIndex + 1} tolerance ${key} must be non-negative`,
                    );
                }
            }
        }
        compiled.push({ startIndex, endIndex });
    }

    compiled.sort((left, right) => left.startIndex - right.startIndex);
    for (let index = 1; index < compiled.length; index += 1) {
        if (compiled[index].startIndex < compiled[index - 1].endIndex) {
            throw validationError('INVALID_MATCHING_SECTIONS', 'Matching sections cannot overlap');
        }
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
    validateMatchingSections,
};
