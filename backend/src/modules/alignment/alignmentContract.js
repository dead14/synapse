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
    // The size guard only ever had an upper bound, so an empty run satisfied
    // it (0 * 0 is below any cell limit) and reached the engine, which
    // truthfully reported zero matches.  Nothing downstream could tell that
    // apart from a matcher that had simply not run yet.
    if (oldCount === 0 || newCount === 0) {
        throw validationError(
            'NO_ALIGNMENT_ANCHORS',
            'Alignment needs at least one anchor in each run; '
            + `received ${oldCount} for oldRun and ${newCount} for newRun.`,
        );
    }
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

// A transform whose evidence gates all passed, or one an engineer explicitly
// signed off on despite a gate warning.  Partial Run deliberately refuses to
// fall back to a scalar offset, so without the acknowledged status a
// REVIEW_REQUIRED estimate would leave the operator with no way forward at all.
const ACCEPTED_TIEIN_DECISION_STATUSES = new Set(['AUTO_ACCEPTED', 'REVIEW_ACKNOWLEDGED']);

// Per-span geometry gate. These constants describe ILI measurement physics
// rather than any one pipeline, so one rule holds for a 0.2 m fitting gap, a
// 10 m joint, and a 25 m multi-joint span. Mirrored exactly in
// `backend/src/python_engines/tiein_engine.py` — change both together.
const MIN_PIPE_GEOMETRY_SPAN_M = 2.0;
const GEOMETRY_NOISE_FLOOR_M = 1.0;
const LOCAL_SCALE_MINIMUM = 0.80;
const LOCAL_SCALE_MAXIMUM = 1.20;
const GEOMETRY_BASELINE_WINDOW_KNOTS = 4;
const GEOMETRY_BASELINE_SHIFT_M = 1.0;

function median(values) {
    const ordered = [...values].sort((left, right) => left - right);
    const middle = ordered.length >> 1;
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/**
 * How far the OLD→NEW offset baseline moves across the span at `index`.
 *
 * A missing or mis-stitched weld displaces every knot downstream of it, so the
 * baseline steps and stays there. A fitting that two vendors report slightly
 * differently makes one knot wobble while the baseline either side is unchanged.
 * A single-span threshold cannot tell those apart; this can. Medians keep the
 * excursion from dragging the window it sits in.
 */
function offsetBaselineShiftM(offsets, index, window = GEOMETRY_BASELINE_WINDOW_KNOTS) {
    const before = offsets.slice(Math.max(0, index - window), index);
    const after = offsets.slice(index, index + window);
    if (before.length === 0 || after.length === 0) return 0;
    return Math.abs(median(after) - median(before));
}

/**
 * Whether the span at `index` changed more than measurement error can explain.
 * Mirrors `geometry_gate_breaches` in tiein_engine.py.
 */
function breachesGeometryGate(knots, offsets, index) {
    const oldSpan = Number(knots[index].oldDistanceM) - Number(knots[index - 1].oldDistanceM);
    const newSpan = Number(knots[index].newDistanceM) - Number(knots[index - 1].newDistanceM);
    const deviation = Math.abs(newSpan - oldSpan);
    const scale = oldSpan > 0 ? newSpan / oldSpan : Infinity;
    const breachedScale = oldSpan >= MIN_PIPE_GEOMETRY_SPAN_M
        && (scale < LOCAL_SCALE_MINIMUM || scale > LOCAL_SCALE_MAXIMUM)
        && deviation > GEOMETRY_NOISE_FLOOR_M;
    // The local delta pins the breach to the span that caused it; the baseline
    // shift is what proves it is a real displacement rather than reporting noise.
    const breachedStep = Math.abs(offsets[index] - offsets[index - 1]) > GEOMETRY_BASELINE_SHIFT_M
        && offsetBaselineShiftM(offsets, index) > GEOMETRY_BASELINE_SHIFT_M;
    return breachedScale || breachedStep;
}

function validateTieInTransform(payload, { maxKnots = 10_000 } = {}) {
    if (payload?.tieInTransform === undefined) return;
    const transform = payload.tieInTransform;
    if (!isRecord(transform)
        || !ACCEPTED_TIEIN_DECISION_STATUSES.has(payload?.tieInDecision?.status)
        || transform.direction !== 'OLD_TO_NEW'
        || transform.model !== 'MONOTONIC_PIECEWISE_LINEAR'
        || transform.allowExtrapolation !== false
        || !Array.isArray(transform.knots)
        || transform.knots.length < 2
        || transform.knots.length > maxKnots
        || !isRecord(transform.domain)) {
        throw validationError('INVALID_TIEIN_TRANSFORM', 'Accepted OLD-to-NEW piecewise tie-in evidence is invalid');
    }
    // Two different kinds of check live below.  Strict monotonicity is a
    // structural invariant: a non-monotonic mapping is not a function and every
    // downstream consumer would silently produce garbage, so nobody may waive
    // it.  The spool scale/offset gate is a plausibility heuristic — a spool
    // cannot really change length by 20%, so tripping it usually means a missing
    // weld was stitched to the wrong partner.  That judgement is an engineer's
    // to make, so an explicitly acknowledged decision is allowed past it while
    // the reasons stay recorded on the decision for the audit trail.
    const enforcesPlausibilityGate = payload.tieInDecision.status === 'AUTO_ACCEPTED';
    let previous = null;
    for (const knot of transform.knots) {
        const oldDistance = Number(knot?.oldDistanceM);
        const newDistance = Number(knot?.newDistanceM);
        if (!Number.isFinite(oldDistance) || !Number.isFinite(newDistance)
            || (previous && (oldDistance <= previous.oldDistance || newDistance <= previous.newDistance))) {
            throw validationError('INVALID_TIEIN_TRANSFORM', 'Tie-in knots must increase strictly on OLD and NEW');
        }
        previous = { oldDistance, newDistance };
    }
    if (enforcesPlausibilityGate) {
        const offsets = transform.knots.map((knot) => Number(knot.newDistanceM) - Number(knot.oldDistanceM));
        for (let index = 1; index < transform.knots.length; index += 1) {
            if (breachesGeometryGate(transform.knots, offsets, index)) {
                throw validationError('INVALID_TIEIN_TRANSFORM', 'Tie-in transform exceeds the engineering scale/offset gate');
            }
        }
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
    const hasNewDomain = transform.domain.newStartM !== undefined
        || transform.domain.newEndM !== undefined;
    const newDomainStart = Number(transform.domain.newStartM);
    const newDomainEnd = Number(transform.domain.newEndM);
    if (hasNewDomain && (!Number.isFinite(newDomainStart) || !Number.isFinite(newDomainEnd)
        || Math.abs(newDomainStart - Number(first.newDistanceM)) > 1e-6
        || Math.abs(newDomainEnd - Number(last.newDistanceM)) > 1e-6)) {
        throw validationError('INVALID_TIEIN_TRANSFORM', 'Tie-in NEW domain must equal the piecewise knot domain');
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

    // Sections are scoped to the run pair whose locked GWs bound them. Grouping
    // by that scope first is what lets a chain session hold sections for several
    // pairs at once: validated against one flat lock list, a section from any
    // other pair looks like it references a boundary that does not exist.
    const pairKeys = new Set(sections.map((section) => String(section?.pairKey ?? '')));
    for (const pairKey of pairKeys) {
        validateSectionsForPair(
            sections.filter((section) => String(section?.pairKey ?? '') === pairKey),
            pairKey && isRecord(config?.pairGwResults?.[pairKey])
                ? config.pairGwResults[pairKey].gwMatchesFinal
                : config?.gwMatchesFinal,
        );
    }
}

function validateSectionsForPair(sections, gwMatchesFinal) {
    const lockedPairs = Array.isArray(gwMatchesFinal)
        ? [...gwMatchesFinal].sort(
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

/**
 * A later wizard step resubmits the whole session config. A review timestamp is
 * persistence metadata, not a fresh operator decision, so only the decision
 * key, disposition, and note define whether review evidence changed.
 */
function gwReviewDecisionFingerprint(review) {
    if (!isRecord(review)) return null;
    return JSON.stringify(Object.entries(review)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, decision]) => [
            key,
            isRecord(decision) ? { disposition: decision.disposition, note: decision.note } : null,
        ]));
}

function sameGwReviewDecisions(incoming, persisted) {
    const incomingFingerprint = gwReviewDecisionFingerprint(incoming);
    const persistedFingerprint = gwReviewDecisionFingerprint(persisted);
    return incomingFingerprint !== null && incomingFingerprint === persistedFingerprint;
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

/**
 * Validate and normalize each run pair's GW review against that pair's own
 * canonical locks.
 *
 * A chain session reviews every pair separately. Checking all of them against a
 * single shared lock set — the only thing the unscoped path can do — rejects
 * every pair but one, because a lock from the 2012→2024 pair is legitimately
 * absent from the 2024→2026 result.
 */
function normalizePairGwResultsForPersistence(config, {
    pairGwEvidence = {},
    reviewedAt = new Date().toISOString(),
} = {}) {
    const pairResults = config?.pairGwResults;
    if (pairResults === undefined) return undefined;
    if (!isRecord(pairResults)) {
        throw validationError('INVALID_ALIGNMENT_REVIEW', 'Per-pair GW results must be an object');
    }

    const normalized = {};
    for (const [pairKey, pairResult] of Object.entries(pairResults)) {
        if (!isRecord(pairResult)) {
            throw validationError('INVALID_ALIGNMENT_REVIEW', `GW result for pair ${pairKey} must be an object`);
        }
        if (pairResult.gwReview === undefined) {
            normalized[pairKey] = pairResult;
            continue;
        }
        validateAlignmentReview({ gwReview: pairResult.gwReview });
        const locks = normalizeCanonicalGwLocks(pairGwEvidence?.[pairKey]?.canonicalGwLocks);
        const knownKeys = new Set(locks.map(reviewPairKey));
        for (const key of Object.keys(pairResult.gwReview)) {
            if (!knownKeys.has(key)) {
                throw validationError(
                    'INVALID_ALIGNMENT_REVIEW',
                    `GW review for pair ${pairKey} references a pair outside its canonical matching result`,
                );
            }
        }
        const review = Object.fromEntries(Object.entries(pairResult.gwReview).map(([key, decision]) => [key, {
            disposition: decision.disposition,
            note: decision.note,
            reviewedAt,
        }]));
        normalized[pairKey] = {
            ...pairResult,
            gwReview: review,
            gwMatchesFinal: locks.filter((lock) => review[reviewPairKey(lock)]?.disposition !== 'excluded'),
        };
    }
    return normalized;
}

/**
 * GW matching evidence is authored by the server when the DTW run completes.
 * Later wizard steps send a client snapshot that intentionally omits that
 * evidence, so replacing the session JSON with the snapshot must retain the
 * server-owned canonical locks and signatures.  Always prefer the persisted
 * values to prevent a client from replacing trusted evidence.
 */
function preserveCanonicalGwEvidence(config, persistedConfig) {
    const preserved = { ...(config || {}) };
    if (isRecord(persistedConfig?.pairGwEvidence)) {
        preserved.pairGwEvidence = persistedConfig.pairGwEvidence;
    }
    if (Array.isArray(persistedConfig?.canonicalGwLocks)) {
        preserved.canonicalGwLocks = persistedConfig.canonicalGwLocks;
        preserved.gwCanonicalSignature = persistedConfig.gwCanonicalSignature;
    }
    return preserved;
}

function normalizeInterventionEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw validationError('INVALID_INTERVENTION', 'Intervention event must be an object');
    }
    const type = String(event.type || '').toUpperCase();
    const normalized = {
        id: String(event.id || '').trim().slice(0, 120) || `intervention-${Date.now()}`,
        type,
        createdAt: new Date().toISOString(),
    };
    const boundedKey = (value, label, maxLength = 500) => {
        const key = String(value || '').trim();
        if (!key || key.length > maxLength) {
            throw validationError('INVALID_INTERVENTION', `${label} must be a bounded identifier`);
        }
        return key;
    };
    const side = () => {
        const value = String(event.side || '').toUpperCase();
        if (value !== 'OLD' && value !== 'NEW') {
            throw validationError('INVALID_INTERVENTION', 'Exclusion side must be OLD or NEW');
        }
        return value;
    };
    const pairIndex = () => {
        const value = Number(event.pairIndex);
        if (!Number.isSafeInteger(value) || value < 0 || value > 1_000) {
            throw validationError('INVALID_INTERVENTION', 'Pair index must be a bounded non-negative integer');
        }
        return value;
    };

    if (type === 'EXCLUDE_FEATURE') {
        return {
            ...normalized,
            side: side(),
            pairIndex: pairIndex(),
            sourceKey: boundedKey(event.sourceKey, 'Source key'),
        };
    }
    if (type === 'EXCLUDE_RANGE') {
        return {
            ...normalized,
            side: side(),
            pairIndex: pairIndex(),
            startSourceKey: boundedKey(event.startSourceKey, 'Range start source key'),
            endSourceKey: boundedKey(event.endSourceKey, 'Range end source key'),
        };
    }
    if (type === 'RESTORE_EXCLUSION') {
        return {
            ...normalized,
            exclusionId: boundedKey(event.exclusionId, 'Exclusion ID', 120),
        };
    }
    if (type !== 'REASSIGN_NEW') {
        throw validationError('INVALID_INTERVENTION', 'Unsupported intervention type');
    }
    const sourceNewKey = String(event.sourceNewKey || '').trim();
    const targetOldKey = String(event.targetOldKey || '').trim();
    if (!sourceNewKey || !targetOldKey || sourceNewKey.length > 500 || targetOldKey.length > 500) {
        throw validationError('INVALID_INTERVENTION', 'Intervention requires bounded source and target keys');
    }
    const evidenceScore = Number(event.evidenceScore);
    if (!Number.isFinite(evidenceScore) || evidenceScore < 0 || evidenceScore > 100) {
        throw validationError('INVALID_INTERVENTION', 'Evidence score must be between 0 and 100');
    }
    return {
        ...normalized,
        sourceNewKey,
        targetOldKey,
        evidenceScore,
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

function readResultGroup(row) {
    return String(
        row?.['Result Group']
        ?? row?.result_group
        ?? row?.resultGroup
        ?? '',
    ).trim().toUpperCase();
}

// A row is anomaly evidence only when the engine classified it as such.  Rows
// with no group at all are treated as anomalies so that callers passing a plain
// list of anomaly rows (and the older engine payloads) keep working.
function isAnomalyRow(row) {
    const group = readResultGroup(row);
    return group === '' || group === 'ANOMALY';
}

function summarizeComparison(comparison) {
    if (!Array.isArray(comparison)) {
        throw new TypeError('Comparison must be an array');
    }

    // `total` counts every emitted row, which is the conservation figure.
    // Anomaly metrics must exclude GW locks and the bypass/filter buckets:
    // counting those reported "48,000 anomalies" for a run with a few hundred,
    // and diluted matchRate with rows that were never matching candidates.
    const total = comparison.length;
    const anomalyRows = comparison.filter(isAnomalyRow);
    const anomaliesFound = anomalyRows.length;
    const matched = anomalyRows.filter((row) => readMatchStatus(row) === 'matched').length;
    const unmatched = anomaliesFound - matched;

    return {
        total,
        matched,
        unmatched,
        matchRate: anomaliesFound ? Number(((matched / anomaliesFound) * 100).toFixed(1)) : 0,
        anomaliesFound,
    };
}

module.exports = {
    ACCEPTED_TIEIN_DECISION_STATUSES,
    COMPARISON_GROUP_ORDER,
    normalizeComparisonResult,
    summarizeComparison,
    validateDtwPayload,
    validateTieInTransform,
    validateMatchingSections,
    validateAlignmentReview,
    sameGwReviewDecisions,
    normalizeCanonicalGwLocks,
    normalizeAlignmentReviewForPersistence,
    normalizeInterventionEvent,
    normalizePairGwResultsForPersistence,
    preserveCanonicalGwEvidence,
};
