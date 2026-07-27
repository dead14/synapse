/**
 * The gates an alignment session has to pass before its anomalies may be
 * assessed for fitness-for-service. Pure functions — the repository supplies
 * the rows, this module decides.
 *
 * See docs/specs/ffs-alignment-gated-intake.md.
 */

const { alignmentConfigFingerprint } = require('../alignment/alignmentExecution');
const { getAlignmentStrategyCapability } = require('../alignment/alignmentStrategyCapabilities');

const GATE_REASONS = Object.freeze({
    NOT_COMPLETED: 'The alignment session has not reached the final phase.',
    NO_RESULT: 'The alignment session has no stored result summary.',
    MANUAL_ALIGNMENT: 'Manually aligned sessions are not an FFS source.',
    STRATEGY_NOT_VALIDATED: 'The alignment strategy used by this session is not validated.',
    NOT_REVIEWED: 'No Corrosion Analysis review has been saved for this session.',
    NOTHING_SELECTED: 'The Corrosion Analysis review released no feature to FFS.',
    STALE_REVIEW: 'The alignment was re-run after the Corrosion Analysis review; review it again.',
});

function parseParams(session) {
    const raw = session?.params_json;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw) || {};
    } catch (_error) {
        return {};
    }
}

/** Gate A — the session itself reached the final phase through an engine run. */
function finalPhaseRejection(session) {
    if (session?.status !== 'completed') return GATE_REASONS.NOT_COMPLETED;
    const params = parseParams(session);
    if (!params.resultSummary) return GATE_REASONS.NO_RESULT;

    const capability = getAlignmentStrategyCapability(
        params.algorithm || params.summaryData?.algorithm,
    );
    if (capability.id === 'manual') return GATE_REASONS.MANUAL_ALIGNMENT;
    if (!capability.available || !capability.validated) return GATE_REASONS.STRATEGY_NOT_VALIDATED;
    return null;
}

/** The fingerprint a review has to carry to still describe the current result. */
function currentResultSignature(session) {
    return alignmentConfigFingerprint(parseParams(session));
}

/**
 * Gate B — a saved review exists, released at least one feature, and was made
 * against the alignment result that is current now.
 *
 * `review` carries the aggregate from listReviewedSessions: how many features
 * were reviewed, how many were selected, and the signature range across the
 * stored rows (min and max differ only if a save was interleaved with a re-run).
 */
function reviewRejection(session, review) {
    const reviewedCount = Number(review?.reviewed_count ?? review?.reviewedCount ?? 0);
    const selectedCount = Number(review?.selected_count ?? review?.selectedCount ?? 0);
    if (reviewedCount === 0) return GATE_REASONS.NOT_REVIEWED;
    if (selectedCount === 0) return GATE_REASONS.NOTHING_SELECTED;

    const signature = currentResultSignature(session);
    const min = review?.min_signature ?? review?.signature ?? null;
    const max = review?.max_signature ?? review?.signature ?? null;
    if (min !== signature || max !== signature) return GATE_REASONS.STALE_REVIEW;
    return null;
}

/** Combined verdict used by the FFS session picker. */
function evaluateSession(session, review) {
    const gateA = finalPhaseRejection(session);
    if (gateA) return { eligible: false, reason: gateA, stale: false };
    const gateB = reviewRejection(session, review);
    return {
        eligible: gateB === null,
        reason: gateB,
        stale: gateB === GATE_REASONS.STALE_REVIEW,
    };
}

module.exports = {
    GATE_REASONS,
    currentResultSignature,
    evaluateSession,
    finalPhaseRejection,
    parseParams,
    reviewRejection,
};
