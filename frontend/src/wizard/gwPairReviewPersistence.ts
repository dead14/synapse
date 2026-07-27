export interface PersistedPairGwState {
  gwMatchesFinal: unknown[];
  gwOrphans: unknown[];
  gwReview: Record<string, unknown>;
  reviewSignature: string | null;
  ota: number;
  dtwOn: boolean;
  useValveAnchor: boolean;
  strictPenalty: boolean;
}

export interface GwReviewSettings {
  ota: number;
  strictPenalty: boolean;
  useValveAnchor: boolean;
  dtwOn: boolean;
}

/**
 * JSON persistence can reorder nested object keys. Keep arrays ordered (knot
 * and range order matters), while sorting object keys so the client sends the
 * same evidence signature the server validates after a session reload.
 */
function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalJsonValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Mirrors backend/src/modules/alignment/alignmentSignature.js. This is only a
 * client-side stale-review guard; the server remains the authority when it
 * validates the evidence before persistence.
 */
export function canonicalGwReviewSignature(config: any, settings: GwReviewSettings) {
  const oldRunId = Number(config?.summaryData?.oldRun?.runId);
  const newRunId = Number(config?.summaryData?.newRun?.runId);
  const tieInTransform = config?.tieInTransform;
  const tieInDecision = config?.tieInDecision;
  const hasCanonicalTieIn = tieInTransform?.direction === 'OLD_TO_NEW'
    && (tieInDecision?.status === 'AUTO_ACCEPTED' || tieInDecision?.status === 'REVIEW_ACKNOWLEDGED');

  return JSON.stringify({
    oldRunId: Number.isSafeInteger(oldRunId) ? oldRunId : null,
    newRunId: Number.isSafeInteger(newRunId) ? newRunId : null,
    ota: Number(settings.ota) || 0,
    strictPenalty: Boolean(settings.strictPenalty),
    useValveAnchor: Boolean(settings.useValveAnchor),
    applyDtwCorrection: Boolean(settings.dtwOn),
    tieInOffset: hasCanonicalTieIn ? 0 : Number(config?.globalOffset) || 0,
    tieInTransform: canonicalJsonValue(tieInTransform) || null,
    tieInDecisionStatus: tieInDecision?.status || null,
    tieInEvidenceToken: config?.tieInEvidenceToken || null,
    tieInMethodVersion: config?.tieInMethodVersion || null,
    tieInExcludedRanges: canonicalJsonValue(config?.tieInExcludedRanges || []),
  });
}

export function pairResultForPersistence(
  state: PersistedPairGwState,
  currentSignature: string,
) {
  const result: Record<string, unknown> = {
    gwMatchesFinal: state.gwMatchesFinal,
    gwOrphans: state.gwOrphans,
    ota: state.ota,
    dtwOn: state.dtwOn,
    useValveAnchor: state.useValveAnchor,
    strictPenalty: state.strictPenalty,
  };
  if (state.reviewSignature === currentSignature) {
    result.gwReview = state.gwReview;
    result.gwReviewSignature = state.reviewSignature;
  }
  return result;
}
