import type { ComparisonRow } from '../../utils/alignment.ts';

/**
 * Corrosion Analysis — the review an engineer performs on a finished alignment
 * before any feature is released to fitness-for-service.
 *
 * Everything here is derived from fields the alignment engine already produces
 * (see hungarian_engine.format_row); nothing is recomputed from raw ILI data.
 * See docs/specs/ffs-alignment-gated-intake.md.
 */

/** How a feature's metal loss is behaving between the two runs. */
export type GrowthClass = 'active' | 'possibly-active' | 'stable' | 'unknown';

export interface CorrosionFeature {
  sourceKey: string;
  featureId: string;
  section: string;
  featureType: string;
  distanceM: number | null;
  clock: string;
  surface: string;
  depthPct: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  wallMm: number | null;
  depthGrowthPctWtPerYear: number | null;
  lengthGrowthMmPerYear: number | null;
  erf: number | null;
  psafeBar: number | null;
  matchStatus: string;
  physicsWarning: string;
  growthClass: GrowthClass;
  /** True when the feature carries every dimension the B31G engine consumes. */
  ffsReady: boolean;
  /** Why the feature cannot be assessed, when `ffsReady` is false. */
  blockers: string[];
}

export interface CorrosionAnalysisConfig {
  /** Depth growth at or above this rate counts as active corrosion. */
  activeGrowthPctWtPerYear: number;
}

export const DEFAULT_CORROSION_ANALYSIS_CONFIG: CorrosionAnalysisConfig = {
  activeGrowthPctWtPerYear: 0.5,
};

export interface SuggestionRule {
  /** Suggest features whose reported ERF is at or above this value. */
  minErf: number;
  /** Suggest features at or above this reported depth. */
  minDepthPct: number;
  /** Suggest features classified as actively growing. */
  includeActiveGrowth: boolean;
}

export const DEFAULT_SUGGESTION_RULE: SuggestionRule = {
  minErf: 0.9,
  minDepthPct: 40,
  includeActiveGrowth: true,
};

const METAL_LOSS_PATTERN = /metal\s*loss|corros|pit/i;

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim();
  return normalized !== '' && normalized !== '-';
}

function num(value: unknown): number | null {
  if (!present(value)) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, fallback = '-'): string {
  return present(value) ? String(value).trim() : fallback;
}

function classifyGrowth(
  depthGrowth: number | null,
  config: CorrosionAnalysisConfig,
): GrowthClass {
  if (depthGrowth === null) return 'unknown';
  if (depthGrowth >= config.activeGrowthPctWtPerYear) return 'active';
  if (depthGrowth > 0) return 'possibly-active';
  return 'stable';
}

/** Metal-loss features are the only ones B31G has anything to say about. */
export function isMetalLoss(feature: CorrosionFeature): boolean {
  return METAL_LOSS_PATTERN.test(feature.featureType) || feature.depthPct !== null;
}

/**
 * Reads one alignment comparison row into the review model. Rows without a
 * NEW-run feature are not part of the current condition of the line and are
 * skipped by `analyseComparison`.
 */
export function toCorrosionFeature(
  row: ComparisonRow,
  config: CorrosionAnalysisConfig = DEFAULT_CORROSION_ANALYSIS_CONFIG,
): CorrosionFeature | null {
  const sourceKey = text(row['Source Key NEW'], '');
  if (!sourceKey) return null;

  const depthPct = num(row['Depth NEW (%WT)']);
  const lengthMm = num(row['Length NEW (mm)']);
  const widthMm = num(row['Width NEW (mm)']);
  const wallMm = num(row['Wall WT NEW (mm)']);
  const distanceM = num(row['Log Dist NEW (m)']);

  const blockers: string[] = [];
  if (distanceM === null || distanceM < 0) blockers.push('No valid log distance');
  if (depthPct === null) blockers.push('No reported depth');
  // The 80 %WT line is a project rejection threshold applied inside the
  // assessment, not a gate on reaching it. Blocking the handoff here withheld
  // the deepest features on the line from FFS altogether, which is the opposite
  // of what a rejection threshold is for. Only metal loss that leaves no wall
  // to assess is refused. See the matching note in `ffs/validation.ts`.
  else if (depthPct <= 0 || depthPct > 100) blockers.push('Depth outside the 0–100 %WT range');
  if (lengthMm === null || lengthMm <= 0) blockers.push('No reported length');
  if (widthMm === null || widthMm <= 0) blockers.push('No reported width');
  if (wallMm === null || wallMm <= 0) blockers.push('No wall thickness');

  const depthGrowthPctWtPerYear = num(row['Depth Growth (%WT/yr)']);

  return {
    sourceKey,
    featureId: text(row['Identif. NEW'], text(row['Feature ID NEW'], sourceKey)),
    section: text(row['Section NEW'], text(row.Section)),
    featureType: text(row['Feature Type NEW']),
    distanceM,
    clock: text(row["O'Clock NEW"]),
    surface: text(row['Surface NEW']),
    depthPct,
    lengthMm,
    widthMm,
    wallMm,
    depthGrowthPctWtPerYear,
    lengthGrowthMmPerYear: num(row['Length Growth (mm/yr)']),
    erf: num(row['ERF ASME NEW']),
    psafeBar: num(row['Psafe NEW (bar)']),
    matchStatus: text(row['Match/Unmatch'], text(row['Match Status'])),
    physicsWarning: text(row['Physics Warning']),
    growthClass: classifyGrowth(depthGrowthPctWtPerYear, config),
    ffsReady: blockers.length === 0,
    blockers,
  };
}

export function analyseComparison(
  comparison: ComparisonRow[],
  config: CorrosionAnalysisConfig = DEFAULT_CORROSION_ANALYSIS_CONFIG,
): CorrosionFeature[] {
  const features: CorrosionFeature[] = [];
  for (const row of comparison) {
    const feature = toCorrosionFeature(row, config);
    if (feature) features.push(feature);
  }
  return features;
}

export interface CorrosionSummary {
  total: number;
  metalLoss: number;
  ffsReady: number;
  activeGrowth: number;
  unknownGrowth: number;
  withWarnings: number;
}

export function summariseCorrosion(features: CorrosionFeature[]): CorrosionSummary {
  const summary: CorrosionSummary = {
    total: features.length,
    metalLoss: 0,
    ffsReady: 0,
    activeGrowth: 0,
    unknownGrowth: 0,
    withWarnings: 0,
  };
  for (const feature of features) {
    if (isMetalLoss(feature)) summary.metalLoss += 1;
    if (feature.ffsReady) summary.ffsReady += 1;
    if (feature.growthClass === 'active') summary.activeGrowth += 1;
    if (feature.growthClass === 'unknown') summary.unknownGrowth += 1;
    if (feature.physicsWarning !== '-') summary.withWarnings += 1;
  }
  return summary;
}

/**
 * Features a rule would propose. This only ever *offers* a selection — nothing
 * is released to FFS until the engineer saves the review, and a feature that is
 * not assessable is never proposed.
 */
export function suggestSelection(
  features: CorrosionFeature[],
  rule: SuggestionRule = DEFAULT_SUGGESTION_RULE,
): Set<string> {
  const suggested = new Set<string>();
  for (const feature of features) {
    if (!feature.ffsReady || !isMetalLoss(feature)) continue;
    const byErf = feature.erf !== null && feature.erf >= rule.minErf;
    const byDepth = feature.depthPct !== null && feature.depthPct >= rule.minDepthPct;
    const byGrowth = rule.includeActiveGrowth && feature.growthClass === 'active';
    if (byErf || byDepth || byGrowth) suggested.add(feature.sourceKey);
  }
  return suggested;
}

/**
 * The payload saved to the server: every reviewed feature, so that "reviewed
 * and rejected" stays distinguishable from "never looked at".
 */
export interface CorrosionReviewItem {
  sourceKey: string;
  featureId: string;
  selected: boolean;
  reason: string | null;
}

export function buildReviewPayload(
  features: CorrosionFeature[],
  selected: Set<string>,
  reasons: Record<string, string> = {},
): CorrosionReviewItem[] {
  const items: CorrosionReviewItem[] = [];
  for (const feature of features) {
    const isSelected = selected.has(feature.sourceKey);
    const reason = reasons[feature.sourceKey]?.trim() || null;
    if (!isSelected && !reason) continue;
    items.push({
      sourceKey: feature.sourceKey,
      featureId: feature.featureId,
      selected: isSelected,
      reason,
    });
  }
  return items;
}

/**
 * A feature that is not assessable must never reach the engine, whatever the
 * saved review says — an old review can outlive the data that justified it.
 */
export function selectableKeys(features: CorrosionFeature[], selected: Set<string>): Set<string> {
  const usable = new Set<string>();
  for (const feature of features) {
    if (feature.ffsReady && selected.has(feature.sourceKey)) usable.add(feature.sourceKey);
  }
  return usable;
}
