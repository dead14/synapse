function canonicalSignature(payload, { oldRunId, newRunId }) {
    return JSON.stringify({
        oldRunId,
        newRunId,
        ota: Number(payload?.ota) || 0,
        strictPenalty: Boolean(payload?.strictPenalty),
        useValveAnchor: Boolean(payload?.useValveAnchor),
        applyDtwCorrection: Boolean(payload?.applyDtwCorrection),
        tieInOffset: Number(payload?.tieInOffset) || 0,
        tieInTransform: payload?.tieInTransform || null,
        tieInDecisionStatus: payload?.tieInDecision?.status || null,
        tieInEvidenceToken: payload?.tieInEvidenceToken || null,
        tieInMethodVersion: payload?.tieInMethodVersion || null,
        tieInExcludedRanges: payload?.excludedRanges || payload?.tieInExcludedRanges || [],
    });
}

// Must match ACCEPTED_TIEIN_DECISION_STATUSES in alignmentContract.js and
// `usesTransform` in the wizard's tie-in step. If any of the three disagrees
// about whether an acknowledged decision carries a transform, the client and
// server compute different signatures and every saved review is rejected.
const ACCEPTED_TIEIN_STATUSES = new Set(['AUTO_ACCEPTED', 'REVIEW_ACKNOWLEDGED']);

function canonicalSignatureForConfig(config, references) {
    const hasCanonicalTieIn = config?.tieInTransform?.direction === 'OLD_TO_NEW'
        && ACCEPTED_TIEIN_STATUSES.has(config?.tieInDecision?.status);
    return canonicalSignature({
        ota: config?.ota,
        strictPenalty: config?.strictPenalty,
        useValveAnchor: config?.useValveAnchor,
        applyDtwCorrection: config?.dtwOn,
        tieInOffset: hasCanonicalTieIn ? 0 : config?.globalOffset,
        tieInTransform: config?.tieInTransform,
        tieInDecision: config?.tieInDecision,
        tieInEvidenceToken: config?.tieInEvidenceToken,
        tieInMethodVersion: config?.tieInMethodVersion,
        tieInExcludedRanges: config?.tieInExcludedRanges,
    }, references);
}

module.exports = {
    ACCEPTED_TIEIN_STATUSES,
    canonicalSignature,
    canonicalSignatureForConfig,
};
