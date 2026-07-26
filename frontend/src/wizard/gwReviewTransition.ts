export type GwReviewTransitionInput = {
  ota: number;
  strictPenalty: boolean;
  useValveAnchor: boolean;
  dtwOn: boolean;
  gwMatchesFinal: unknown[];
  gwOrphans: unknown[];
  gwReview: unknown;
  gwReviewSignature: string | null;
  sessionRevision?: string;
  sectionOtaOverrides?: Record<string, number>;
};

/**
 * Keep only the canonical evidence needed by later wizard steps. The full
 * match/display arrays are derived by the DTW endpoint and can be recreated;
 * explicitly overwriting them also cleans up sessions saved by older clients.
 */
export function buildGwReviewTransitionPayload(input: GwReviewTransitionInput) {
  return {
    ota: input.ota,
    strictPenalty: input.strictPenalty,
    useValveAnchor: input.useValveAnchor,
    dtwOn: input.dtwOn,
    gwMatches: undefined,
    alignedFeatures: undefined,
    gwMatchesFinal: input.gwMatchesFinal,
    gwOrphans: input.gwOrphans,
    gwReview: input.gwReview,
    gwReviewSignature: input.gwReviewSignature,
    sessionRevision: input.sessionRevision,
    sectionOtaOverrides: input.sectionOtaOverrides,
  };
}
