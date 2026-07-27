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
