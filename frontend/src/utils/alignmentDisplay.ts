import { pofMatchStatus } from '../domain/pof100.ts';

const ORIGINAL_DISTANCE_COLUMN: Record<string, string> = {
  'Log Dist OLD (m)': 'Original Log Dist OLD (m)',
  'Log Dist NEW (m)': 'Original Log Dist NEW (m)',
};

/**
 * The engine tags every row of a chain result with the run pair it came from.
 * Those raw keys are folded into one readable `RUN_PAIR_COLUMN` and then hidden,
 * so a 3-run comparison gains one meaningful column instead of five snake_case
 * ones — and stops looking like a single undifferentiated pile of rows.
 */
const RUN_PAIR_SOURCE_KEYS = ['pair_index', 'pair_key', 'pair_label', 'pair_old_year', 'pair_new_year'] as const;

export const RUN_PAIR_COLUMN = 'Run Pair';
export const MASTER_AXIS_COLUMN = 'Master Axis (m)';

/**
 * The per-pair calculation the engine attached to a matched row: an object, not
 * a cell value. It is read by the evidence drawer and kept out of the table,
 * where it would render as `[object Object]` in a column nobody can sort.
 */
export const MATCH_EVIDENCE_KEY = 'match_evidence';

/**
 * How a result row names the matcher that produced it. Keep in step with
 * `MATCH_METHOD` on each engine class and with `ANOMALY_MATCHERS` in
 * `backend/src/modules/alignment/anomalyMatchers.js`.
 *
 * AURORA is not in that registry: it is not a Phase-2 matcher that a
 * girth-weld run can be pointed at, it owns both phases. It appears here
 * anyway because a result row still has to say what produced it.
 */
export const MATCH_METHOD_LABELS: Record<string, string> = {
  HUNGARIAN: 'Tolerance gates (Hungarian)',
  BAYESIAN_DRIFT: 'Bayesian drift matching',
  AURORA_ILI: 'AURORA-ILI universal registration',
};

const DISPLAY_METADATA_COLUMNS = new Set([
  ...Object.values(ORIGINAL_DISTANCE_COLUMN),
  ...RUN_PAIR_SOURCE_KEYS,
  MATCH_EVIDENCE_KEY,
]);

/** Rows carrying a readable `Run Pair` value, or the input untouched when the
 * result is a single-pair comparison with nothing to distinguish. */
export function withRunPairColumn<T extends Record<string, unknown>>(rows: readonly T[]): T[] {
  const labelled = rows.map((row) => {
    const label = row.pair_label
      ?? (row.pair_old_year && row.pair_new_year ? `${row.pair_old_year} → ${row.pair_new_year}` : undefined)
      ?? (row.pair_index !== undefined && row.pair_index !== null ? `Pair ${Number(row.pair_index) + 1}` : undefined);
    return label === undefined ? row : { ...row, [RUN_PAIR_COLUMN]: label };
  });
  const labels = new Set(labelled.map((row) => row[RUN_PAIR_COLUMN]).filter((value) => value !== undefined));
  return labels.size > 1 ? labelled : rows.map((row) => ({ ...row }));
}

export function runPairLabels<T extends Record<string, unknown>>(rows: readonly T[]): string[] {
  return [...new Set(
    rows.map((row) => row[RUN_PAIR_COLUMN]).filter((value): value is string => typeof value === 'string'),
  )].sort();
}

function hasDistance(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && (value.trim() === '' || value.trim() === '-')) return false;
  return Number.isFinite(Number(value));
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && (value.trim() === '' || value.trim() === '-')) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Converts the engine's depth-growth rate from % wall-thickness/year to mm/year.
 * The NEW wall thickness is the current reference; OLD is retained as a
 * fallback for rows where NEW thickness is unavailable.
 */
export function depthGrowthMmPerYear<T extends Record<string, unknown>>(row: T): number | null {
  const growthPctPerYear = finiteNumber(row['Depth Growth (%WT/yr)']);
  const newWallThickness = finiteNumber(row['Wall WT NEW (mm)']);
  const oldWallThickness = finiteNumber(row['Wall WT OLD (mm)']);
  const wallThickness = newWallThickness ?? oldWallThickness;
  if (growthPctPerYear === null || wallThickness === null || wallThickness <= 0) return null;
  return (growthPctPerYear / 100) * wallThickness;
}

/**
 * Result columns whose values are the engine's own status words, shown in the
 * POF 100 wording instead. The translation happens here rather than in the cell
 * renderer so the column filter, the sort and the badge all work on the word
 * the engineer is actually looking at — a table that displays "Missing" and
 * then finds nothing when "Missing" is typed into its filter is worse than one
 * that never translated at all.
 */
const MATCH_STATUS_COLUMNS = new Set(['Match/Unmatch', 'Match Status']);

export function alignmentDisplayValue<T extends Record<string, unknown>>(row: T, column: string): T[string] {
  if (column === MASTER_AXIS_COLUMN) {
    return (alignmentMasterAxisDistance(row) ?? '-') as T[string];
  }
  if (MATCH_STATUS_COLUMNS.has(column)) {
    const status = row[column];
    return (typeof status === 'string' ? pofMatchStatus(status) : status) as T[string];
  }
  const originalColumn = ORIGINAL_DISTANCE_COLUMN[column];
  const originalDistance = originalColumn ? row[originalColumn] : undefined;
  return (hasDistance(originalDistance) ? originalDistance : row[column]) as T[string];
}

export function isAlignmentDisplayMetadata(column: string): boolean {
  return DISPLAY_METADATA_COLUMNS.has(column);
}

/**
 * Build the table schema from the complete result set. Engine buckets do not
 * all carry the same fields (GW rows are commonly first and anomaly dimensions
 * arrive later), so inspecting only row zero silently hides real result data.
 */
export function alignmentResultColumns<T extends Record<string, unknown>>(rows: readonly T[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (column.startsWith('__') || isAlignmentDisplayMetadata(column) || seen.has(column)) continue;
      seen.add(column);
      columns.push(column);
    }
  }
  return columns;
}

type AuditSide = { inputCount?: number; outputReferences?: number };
type AuditItem = { isConserved?: boolean; old?: AuditSide; new?: AuditSide };

export function summarizeConservationAudit(
  audit?: AuditItem & { pairs?: AuditItem[] },
): {
  state: 'verified' | 'warning' | 'unknown';
  pairCount: number;
  old: { inputCount: number; outputReferences: number };
  new: { inputCount: number; outputReferences: number };
} {
  const items = Array.isArray(audit?.pairs) && audit.pairs.length > 0
    ? audit.pairs
    : audit ? [audit] : [];
  const totalSide = (side: 'old' | 'new') => items.reduce(
    (total, item) => ({
      inputCount: total.inputCount + Number(item?.[side]?.inputCount || 0),
      outputReferences: total.outputReferences + Number(item?.[side]?.outputReferences || 0),
    }),
    { inputCount: 0, outputReferences: 0 },
  );
  return {
    state: items.length === 0
      ? 'unknown'
      : items.every((item) => item?.isConserved === true) ? 'verified' : 'warning',
    pairCount: items.length,
    old: totalSide('old'),
    new: totalSide('new'),
  };
}

/**
 * Same rule as `hungarian_engine._is_cluster_feature`: a vendor-merged
 * corrosion group is never aligned across runs. Every vendor writes it
 * differently — "CLUSTER corrosion", "Corrosion CLUSTER", "Clustered metal
 * loss" — so the word itself is what is matched, not a fixed label.
 */
const CLUSTER_LABEL_PATTERN = /\b(?:cluster|klaster|kluster)s?(?:ed|ing)?\b/i;

/** Classification columns only. A free-text comment must not reclassify a row. */
const CLUSTER_CLASSIFICATION_COLUMNS = [
  'Feature Identification OLD',
  'Feature Identification NEW',
  'Feature Type OLD',
  'Feature Type NEW',
] as const;

/**
 * Whether either side of a comparison row is clustered metal loss.
 *
 * This answers "is this row a cluster", not "may it be reassigned". Callers
 * pair it with the session's `ToleranceConfig.cluster_alignment`: under the
 * default `bypass` the engine kept these out of matching, and the manual
 * reassignment path applies the same rule so an engineer cannot pair by hand
 * what the algorithm refused to pair. Under `align` the engine paired them, and
 * the manual path must not contradict it. The row stays in the table either
 * way — clusters are excluded from *alignment*, never from the report or ERF.
 */
export function isClusteredAlignmentRow<T extends Record<string, unknown>>(row: T): boolean {
  return CLUSTER_CLASSIFICATION_COLUMNS.some((column) => {
    const value = row[column];
    return typeof value === 'string' && CLUSTER_LABEL_PATTERN.test(value);
  });
}

/* ---------------------------------------------------------------------------
 * Feature visibility
 * ------------------------------------------------------------------------ */

/**
 * The classes the Feature rules step can switch off. Keep in step with
 * `TOGGLEABLE_FEATURE_TYPES` in `frontend/src/wizard/matchingRules.ts`, which is
 * what writes the saved `hiddenFeatures` list this reads.
 */
export type ToggleableFeatureKind = 'valve' | 'tee' | 'bend' | 'offtake' | 'other';

/**
 * The vendor labels a class is recognised by, in resolution order.
 *
 * Mirrors `FITTING_CLASS_PATTERNS` in `hungarian_engine.py`, with one deliberate
 * split: the engine files tees, offtakes and branch connections under a single
 * "Tee / offtake" identity class because it has to pair them ordinally, while
 * the report offers them as two switches. Offtake is therefore tested first, so
 * "offtake" never falls through to the tee pattern.
 */
const FEATURE_KIND_PATTERNS: ReadonlyArray<[ToggleableFeatureKind, RegExp]> = [
  ['valve', /\bvalves?\b/i],
  ['offtake', /\boff[\s_-]?takes?\b/i],
  ['tee', /\btees?\b|\bbranch(?:\s+connection)?\b/i],
  ['bend', /\b(?:bends?|elbows?)\b/i],
];

/** Metal loss, whatever the vendor called it. Never hideable — it is the report. */
const METAL_LOSS_PATTERN = /\b(?:anomal(?:y|ies)|metal[\s_-]?loss|corrosion|corr|pitting|pit)\b/i;

/**
 * Circumferential joint welds. Never hideable either: they are what anchors
 * every matched anomaly, and the Feature rules step locks them on for that
 * reason. Longitudinal seams are excluded for the same reason
 * `gw_distance_derivation` excludes them — they are not joint boundaries.
 */
const WELD_PATTERN = /\b(?:girth|gw|welds?)\b/i;
const NON_GIRTH_WELD_PATTERN = /\b(?:seam|longitudinal|spiral|helical|erw|dsaw|lsaw)\b/i;

const CLASSIFICATION_COLUMNS = [
  'Feature Type OLD',
  'Feature Type NEW',
  'Feature Identification OLD',
  'Feature Identification NEW',
] as const;

function classificationText<T extends Record<string, unknown>>(row: T): string {
  return CLASSIFICATION_COLUMNS
    .map((column) => row[column])
    .filter((value) => typeof value === 'string' && value.trim() !== '' && value.trim() !== '-')
    .join(' ');
}

/**
 * Which switchable class a result row belongs to, or `null` when it is one the
 * report always shows.
 *
 * A row the engine bucketed as an anomaly is `null` regardless of how its label
 * reads: the matched metal loss is the report, and a vendor who wrote "Bend"
 * into a corrosion row's identification column must not be able to make that
 * defect vanish from an engineer's screen.
 */
export function toggleableFeatureKind<T extends Record<string, unknown>>(
  row: T,
): ToggleableFeatureKind | null {
  if (String(row['Result Group'] ?? '').trim().toUpperCase() === 'ANOMALY') return null;
  const text = classificationText(row);
  if (METAL_LOSS_PATTERN.test(text)) return null;
  for (const [kind, pattern] of FEATURE_KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  if (WELD_PATTERN.test(text) && !NON_GIRTH_WELD_PATTERN.test(text)) return null;
  // An unlabelled row the engine bucketed as a Phase-1 anchor is a girth weld —
  // that is what the bucket holds once the fittings above have been taken out
  // of it. Letting it fall through to `other` would put the welds that anchor
  // every matched anomaly behind the "Other features" switch.
  if (String(row['Result Group'] ?? '').trim().toUpperCase() === 'GW') return null;
  return 'other';
}

/** Whether the saved Feature rules keep this row out of the report. */
export function isHiddenAlignmentRow<T extends Record<string, unknown>>(
  row: T,
  hiddenFeatures: readonly string[],
): boolean {
  if (hiddenFeatures.length === 0) return false;
  const kind = toggleableFeatureKind(row);
  return kind !== null && hiddenFeatures.includes(kind);
}

/** The saved list, narrowed to entries this module knows how to act on. */
export function normalizeHiddenFeatures(value: unknown): ToggleableFeatureKind[] {
  if (!Array.isArray(value)) return [];
  const known: readonly ToggleableFeatureKind[] = ['valve', 'tee', 'bend', 'offtake', 'other'];
  return known.filter((kind) => value.includes(kind));
}

function mappedDistance(value: unknown): number | null {
  return hasDistance(value) ? Number(value) : null;
}

/**
 * Canonical spatial coordinate used by the aligned viewer. NEW is already on
 * the master odometer; an OLD-only row carries its TIE-in projection in the
 * mapped Log Dist OLD field while its vendor-reported LD remains display-only.
 */
export function alignmentMasterAxisDistance<T extends Record<string, unknown>>(row: T): number | null {
  return mappedDistance(row['Log Dist NEW (m)']) ?? mappedDistance(row['Log Dist OLD (m)']);
}

export function sortAlignmentRowsByMasterAxis<T extends Record<string, unknown>>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      masterDistance: alignmentMasterAxisDistance(row),
    }))
    .sort((left, right) => {
      const leftDistance = left.masterDistance ?? Number.POSITIVE_INFINITY;
      const rightDistance = right.masterDistance ?? Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance || left.index - right.index;
    })
    .map(({ row }) => row);
}
