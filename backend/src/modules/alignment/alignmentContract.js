const COMPARISON_GROUP_ORDER = Object.freeze([
    'gw_locked',
    'gw_unmatched',
    'anomaly_matched',
    'anomaly_only_old',
    'anomaly_only_new',
    'bypassed_old',
    'bypassed_new',
    'filtered_old',
    'filtered_new',
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
    if (payload.partialRunEnabled === true && payload.tieInTransform === undefined) {
        throw validationError(
            'PARTIAL_RUN_TIEIN_REQUIRED',
            'Partial-run alignment requires accepted TIE IN evidence; raw odometer matching is blocked.',
        );
    }
    validateTieInTransform(payload);
}

function validateTieInTransform(payload, { maxKnots = 10_000 } = {}) {
    if (payload?.tieInTransform === undefined) return;
    const transform = payload.tieInTransform;
    if (!isRecord(transform)
        || payload?.tieInDecision?.status !== 'AUTO_ACCEPTED'
        || transform.direction !== 'OLD_TO_NEW'
        || transform.model !== 'MONOTONIC_PIECEWISE_LINEAR'
        || transform.allowExtrapolation !== false
        || !Array.isArray(transform.knots)
        || transform.knots.length < 2
        || transform.knots.length > maxKnots
        || !isRecord(transform.domain)) {
        throw validationError('INVALID_TIEIN_TRANSFORM', 'Accepted OLD-to-NEW piecewise tie-in evidence is invalid');
    }
    let previous = null;
    for (const knot of transform.knots) {
        const oldDistance = Number(knot?.oldDistanceM);
        const newDistance = Number(knot?.newDistanceM);
        if (!Number.isFinite(oldDistance) || !Number.isFinite(newDistance)
            || (previous && (oldDistance <= previous.oldDistance || newDistance <= previous.newDistance))) {
            throw validationError('INVALID_TIEIN_TRANSFORM', 'Tie-in knots must increase strictly on OLD and NEW');
        }
        if (previous) {
            const oldSpan = oldDistance - previous.oldDistance;
            const newSpan = newDistance - previous.newDistance;
            if ((oldSpan >= 2 && (newSpan / oldSpan < 0.80 || newSpan / oldSpan > 1.20))
                || Math.abs(newSpan - oldSpan) > 1.5) {
                throw validationError('INVALID_TIEIN_TRANSFORM', 'Tie-in transform exceeds the engineering scale/offset gate');
            }
        }
        previous = { oldDistance, newDistance };
    }
    const first = transform.knots[0];
    const last = transform.knots[transform.knots.length - 1];
    const domainStart = Number(transform.domain.oldStartM);
    const domainEnd = Number(transform.domain.oldEndM);
    if (!Number.isFinite(domainStart) || !Number.isFinite(domainEnd)
        || Math.abs(domainStart - Number(first.oldDistanceM)) > 1e-6
        || Math.abs(domainEnd - Number(last.oldDistanceM)) > 1e-6) {
        throw validationError('INVALID_TIEIN_TRANSFORM', 'Tie-in domain must equal the piecewise knot domain');
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

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDateTime(value) {
    if (typeof value !== 'string'
        || value.length !== 24
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
        return false;
    }
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function reviewIdentityPart(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(6);
    return 'none';
}

function reviewPairKey(pair) {
    const oldId = pair?.old_id ?? pair?.oldId;
    const newId = pair?.new_id ?? pair?.newId;
    if (oldId !== null && oldId !== undefined && newId !== null && newId !== undefined) {
        return `${reviewIdentityPart(oldId)}::${reviewIdentityPart(newId)}`;
    }
    const oldDistance = Number(pair?.old_odometer ?? pair?.oldVal ?? pair?.oldDist);
    const newDistance = Number(pair?.new_odometer ?? pair?.newVal ?? pair?.newDist);
    return `${oldDistance.toFixed(6)}::${newDistance.toFixed(6)}`;
}

function normalizeCanonicalGwLocks(value) {
    if (!Array.isArray(value)) {
        throw validationError('INVALID_CANONICAL_GW_LOCKS', 'A canonical GW matching result is required before review');
    }
    if (value.length > 10_000) {
        throw validationError('INVALID_CANONICAL_GW_LOCKS', 'Canonical GW locks exceed the configured limit');
    }
    const keys = new Set();
    return value.map((pair) => {
        const oldId = pair?.old_id ?? pair?.oldId;
        const newId = pair?.new_id ?? pair?.newId;
        const oldOdometer = Number(pair?.old_odometer ?? pair?.oldVal ?? pair?.oldDist);
        const newOdometer = Number(pair?.new_odometer ?? pair?.newVal ?? pair?.newDist);
        if (oldId === null || oldId === undefined || newId === null || newId === undefined
            || !String(oldId).trim() || !String(newId).trim()
            || !Number.isFinite(oldOdometer) || !Number.isFinite(newOdometer)) {
            throw validationError('INVALID_CANONICAL_GW_LOCKS', 'Canonical GW locks must contain source identities and finite odometers');
        }
        const normalized = {
            old_id: String(oldId),
            new_id: String(newId),
            old_odometer: oldOdometer,
            new_odometer: newOdometer,
            type: 'GW',
            status: 'MATCHED',
        };
        const key = reviewPairKey(normalized);
        if (keys.has(key)) {
            throw validationError('INVALID_CANONICAL_GW_LOCKS', 'Canonical GW locks cannot repeat a source pair');
        }
        keys.add(key);
        return normalized;
    });
}

function validateAlignmentReview(config, { maxDecisions = 10_000 } = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw validationError('INVALID_ALIGNMENT_REVIEW', 'Alignment review must belong to an object config');
    }
    if (config.dataReview !== undefined) {
        const review = config.dataReview;
        if (!isRecord(review)
            || review.status !== 'acknowledged'
            || !isIsoDateTime(review.reviewedAt)
            || !isNonNegativeInteger(review.masterFeatureCount)
            || !isNonNegativeInteger(review.historicalFeatureCount)) {
            throw validationError('INVALID_ALIGNMENT_REVIEW', 'Data review evidence is invalid');
        }
    }
    if (config.gwReview === undefined) return;
    if (!isRecord(config.gwReview)) {
        throw validationError('INVALID_ALIGNMENT_REVIEW', 'GW review must be an object');
    }
    const decisions = Object.entries(config.gwReview);
    if (decisions.length > maxDecisions) {
        throw validationError('INVALID_ALIGNMENT_REVIEW', `GW review may contain at most ${maxDecisions} decisions`);
    }
    for (const [key, decision] of decisions) {
        if (!key.trim() || key.length > 500 || !isRecord(decision)
            || !['accepted', 'review', 'excluded'].includes(decision.disposition)
            || typeof decision.note !== 'string' || decision.note.length > 500
            || !isIsoDateTime(decision.reviewedAt)) {
            throw validationError('INVALID_ALIGNMENT_REVIEW', 'GW review contains an invalid decision');
        }
    }
}

function normalizeAlignmentReviewForPersistence(config, {
    featureCounts = null,
    canonicalGwLocks = undefined,
    existingDataReview = null,
    reviewedAt = new Date().toISOString(),
} = {}) {
    validateAlignmentReview(config);
    const normalized = { ...config };

    if (config.dataReview !== undefined) {
        const masterFeatureCount = featureCounts?.master;
        const historicalFeatureCount = featureCounts?.historical;
        if (!isNonNegativeInteger(masterFeatureCount) || !isNonNegativeInteger(historicalFeatureCount)
            || masterFeatureCount === 0 || historicalFeatureCount === 0) {
            throw validationError('INVALID_ALIGNMENT_REVIEW', 'Data review requires two populated persisted inspection runs');
        }
        const retained = isRecord(existingDataReview)
            && existingDataReview.status === 'acknowledged'
            && isIsoDateTime(existingDataReview.reviewedAt)
            && existingDataReview.masterFeatureCount === masterFeatureCount
            && existingDataReview.historicalFeatureCount === historicalFeatureCount;
        normalized.dataReview = retained
            ? existingDataReview
            : {
                status: 'acknowledged',
                reviewedAt,
                masterFeatureCount,
                historicalFeatureCount,
            };
    }

    if (config.gwReview !== undefined) {
        const locks = normalizeCanonicalGwLocks(canonicalGwLocks);
        const knownKeys = new Set(locks.map(reviewPairKey));
        for (const key of Object.keys(config.gwReview)) {
            if (!knownKeys.has(key)) {
                throw validationError('INVALID_ALIGNMENT_REVIEW', 'GW review references a pair outside the canonical matching result');
            }
        }
        normalized.gwReview = Object.fromEntries(Object.entries(config.gwReview).map(([key, decision]) => [key, {
            disposition: decision.disposition,
            note: decision.note,
            reviewedAt,
        }]));
        normalized.gwMatchesFinal = locks.filter((pair) => normalized.gwReview[reviewPairKey(pair)]?.disposition !== 'excluded');
        normalized.canonicalGwLocks = locks;
    }

    return normalized;
}

function normalizeInterventionEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw validationError('INVALID_INTERVENTION', 'Intervention event must be an object');
    }
    const type = String(event.type || '').toUpperCase();
    const sourceNewKey = String(event.sourceNewKey || '').trim();
    const targetOldKey = String(event.targetOldKey || '').trim();
    if (type !== 'REASSIGN_NEW') {
        throw validationError('INVALID_INTERVENTION', 'Unsupported intervention type');
    }
    if (!sourceNewKey || !targetOldKey || sourceNewKey.length > 500 || targetOldKey.length > 500) {
        throw validationError('INVALID_INTERVENTION', 'Intervention requires bounded source and target keys');
    }
    const evidenceScore = Number(event.evidenceScore);
    if (!Number.isFinite(evidenceScore) || evidenceScore < 0 || evidenceScore > 100) {
        throw validationError('INVALID_INTERVENTION', 'Evidence score must be between 0 and 100');
    }
    return {
        id: String(event.id || '').trim().slice(0, 120) || `intervention-${Date.now()}`,
        type,
        sourceNewKey,
        targetOldKey,
        evidenceScore,
        createdAt: new Date().toISOString(),
    };
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
    validateTieInTransform,
    validateMatchingSections,
    validateAlignmentReview,
    normalizeCanonicalGwLocks,
    normalizeAlignmentReviewForPersistence,
    normalizeInterventionEvent,
};
