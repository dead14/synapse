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
 */
export const MATCH_METHOD_LABELS: Record<string, string> = {
  HUNGARIAN: 'Tolerance gates (Hungarian)',
  BAYESIAN_DRIFT: 'Bayesian drift matching',
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

export function alignmentDisplayValue<T extends Record<string, unknown>>(row: T, column: string): T[string] {
  if (column === MASTER_AXIS_COLUMN) {
    return (alignmentMasterAxisDistance(row) ?? '-') as T[string];
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
 * The engine already keeps these out of matching; this is the same rule applied
 * to the manual reassignment path, so an engineer cannot pair by hand what the
 * algorithm refused to pair. The row stays in the table either way — clusters
 * are excluded from *alignment*, never from the report or from ERF.
 */
export function isClusteredAlignmentRow<T extends Record<string, unknown>>(row: T): boolean {
  return CLUSTER_CLASSIFICATION_COLUMNS.some((column) => {
    const value = row[column];
    return typeof value === 'string' && CLUSTER_LABEL_PATTERN.test(value);
  });
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
