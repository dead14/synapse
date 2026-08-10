/**
 * The AURORA-ILI stage artifacts, as they arrive from the engine.
 *
 * They travel inside the conservation audit rather than as their own top-level
 * key: the alignment contract flattens every top-level array of the engine
 * payload straight into the comparison table, so an artifact list would turn
 * into result rows.
 */

export interface AuroraSummary {
  state: string;
  mode: string;
  modeReasons: string[];
  matchGroups: number;
  autoAccepted: number;
  reviewRequired: number;
  regionOnly: number;
  structuralChange: number;
  anchorPairs: number;
  rescueAttempts: number;
  rescueAccepted: number;
  configVersion: string;
  modelVersion: string;
  /** Which run pair produced these artifacts, e.g. "2012 → 2026". */
  pairLabel?: string;
}

export interface AuroraCapabilityProfile {
  anchorCountOld: number;
  anchorCountNew: number;
  anchorCoverage: number;
  medianAnchorGapM: number | null;
  clockCoverage: number;
  dimensionCoverage: number;
  surfaceCoverage: number;
  metalLossOld: number;
  metalLossNew: number;
  densityRatio: number | null;
  coarseOffsetM: number;
  driftEstimateM: number;
  toolComparability: number;
  crossTechnology: boolean;
  runCount: number;
}

export interface AuroraChangeZone {
  oldXFrom: number | null;
  oldXTo: number | null;
  newXFrom: number | null;
  newXTo: number | null;
  reason: string;
  inserted: number;
  deleted: number;
}

export interface AuroraAnchorMap {
  coarseOffsetM: number;
  confidence: number;
  matched: number;
  inserted: number;
  deleted: number;
  eventCount: number;
  changeZones: AuroraChangeZone[];
}

export interface AuroraJointMap {
  jointCount: number;
  trusted: number;
  uncertain: number;
  changed: number;
}

export interface AuroraTransformState {
  pjid: string;
  sequence: number;
  axialScale: number;
  axialResidualM: number;
  clockRotationDeg: number;
  clockRotationHours: number;
  support: number;
  confidence: number;
  provenance: string;
}

export interface AuroraTransformField {
  stateCount: number;
  medianAxialScale: number | null;
  medianClockRotationDeg: number | null;
  rotatedJoints: number;
  driftCheck: {
    joints?: number;
    totalAccumulatedDriftM?: number;
    maxIdentityResidualM?: number;
    explained?: boolean | null;
  };
  states: AuroraTransformState[];
}

export interface AuroraRescueCase {
  pjid: string;
  triggerReason: string;
  status: string;
  sourcePoints: number;
  targetPoints: number;
  clockRotationDeg: number;
  clockRotationHours: number;
  axialShiftU: number;
  inliers: number;
  inlierFraction: number;
  ambiguity: number;
  regionCorrelation: number;
}

export interface AuroraReviewItem {
  pjid: string;
  type: string;
  confidenceClass: string;
  probability: number;
  ambiguityMargin: number;
  regionConfidence: number;
  featureConfidence: number;
  rescueMode: string | null;
  explanation: string[];
}

export interface AuroraWarning {
  code: string;
  severity: string;
  message: string;
}

export interface AuroraArtifacts {
  summary: AuroraSummary;
  capabilityProfile: AuroraCapabilityProfile | null;
  anchorMap: AuroraAnchorMap | null;
  persistentJointMap: AuroraJointMap | null;
  transformField: AuroraTransformField | null;
  rescueCases: AuroraRescueCase[];
  reviewQueue: AuroraReviewItem[];
  reviewQueueTotal: number;
  warnings: AuroraWarning[];
  failureReason: string | null;
}

/** Plain-language name for each operating mode, keyed by its engine id. */
export const AURORA_MODE_LABELS: Record<string, string> = {
  M1_STANDARD: 'Standard',
  M2_SEVERE_DRIFT: 'Severe drift',
  M3_SPARSE_ANCHOR: 'Sparse anchors',
  M4_CROSS_TECH: 'Cross-technology',
  M5_STRUCTURAL_CHANGE: 'Structural change',
  M6_MULTI_RUN: 'Multi-run',
  M7_PATTERN_RESCUE: 'Pattern rescue',
};

/** What the engine was able to conclude, in the operator's words. */
export const AURORA_STATE_LABELS: Record<string, string> = {
  REVIEW_READY: 'Ready for review',
  INSUFFICIENT_EVIDENCE: 'Insufficient physical evidence',
  FAILED_INPUT: 'Input rejected',
};

/**
 * Every AURORA artifact set in one conservation audit.
 *
 * A chain alignment runs the engine once per run pair and merges the audits
 * into `audit.pairs`, so a single-pair lookup would show nothing at all for the
 * multi-pair sessions that need the evidence most.
 */
export function collectAuroraArtifacts(
  audit: { aurora?: AuroraArtifacts; pairs?: { aurora?: AuroraArtifacts }[] } | undefined,
): AuroraArtifacts[] {
  if (!audit) return [];
  if (audit.aurora) return [audit.aurora];
  return (audit.pairs || [])
    .map((pair) => pair?.aurora)
    .filter((artifacts): artifacts is AuroraArtifacts => Boolean(artifacts));
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMetres(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)} m`;
}
