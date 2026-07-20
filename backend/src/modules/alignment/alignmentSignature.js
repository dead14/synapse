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

function canonicalSignatureForConfig(config, references) {
    const hasCanonicalTieIn = config?.tieInTransform?.direction === 'OLD_TO_NEW'
        && config?.tieInDecision?.status === 'AUTO_ACCEPTED';
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
    canonicalSignature,
    canonicalSignatureForConfig,
};
