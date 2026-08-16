/**
 * The ILI alignment registry, as the browser reads it.
 *
 * This is the only survey-data table in the product now: the separate ILI-runs
 * page listed the same runs a second time, with a second set of actions, and
 * the two disagreed about what state a run was in often enough to be a problem
 * of its own. A row here therefore has to answer both questions — which runs
 * were compared and what has been done with the result.
 *
 * Everything is normalised on the way in. The API is trusted to be the API, not
 * to be well-formed: a row that arrives half-built renders as "not recorded"
 * rather than as `undefined` in the middle of a table.
 */

export type AlignmentStage = 'running' | 'failed' | 'aligned' | 'released' | 'assessed';

export interface AlignmentRunSide {
  runId: number | null;
  name: string | null;
  vendor: string | null;
  surveyYear: number | null;
  surveyDate: string | null;
  rowCount: number | null;
}

export interface AlignmentFfsState {
  sessionId: string;
  createdAt: string | null;
  featureCount: number;
  summary: Record<string, number | string | boolean>;
  /** How many assessments have been filed against this alignment. */
  sessionCount: number;
}

export interface AlignmentRegistryRow {
  id: string;
  pipelineId: number | null;
  pipelineName: string;
  algorithm: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  matchRate: number | null;
  anomaliesFound: number;
  runs: { old: AlignmentRunSide; new: AlignmentRunSide };
  result: { available: boolean; completedAt: string | null };
  review: { reviewedCount: number; selectedCount: number };
  /** Null until an FFS assessment has been filed against this alignment. */
  ffs: AlignmentFfsState | null;
  stage: AlignmentStage;
}

const STAGES: ReadonlySet<string> = new Set<AlignmentStage>([
  'running', 'failed', 'aligned', 'released', 'assessed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

/**
 * A number the API may simply not have.
 *
 * `Number(null)` and `Number('')` are both 0, so a bare `Number.isFinite` guard
 * turns "no survey year recorded" into "surveyed in year 0". Absent is not zero.
 */
function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function counter(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeRunSide(value: unknown): AlignmentRunSide {
  const source = isRecord(value) ? value : {};
  return {
    runId: finite(source.runId),
    name: text(source.name),
    vendor: text(source.vendor),
    surveyYear: finite(source.surveyYear),
    surveyDate: text(source.surveyDate),
    rowCount: finite(source.rowCount),
  };
}

/** Only display-safe scalars survive: this object is rendered, not calculated. */
function normalizeSummary(value: unknown): Record<string, number | string | boolean> {
  if (!isRecord(value)) return {};
  const output: Record<string, number | string | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) output[key] = item;
    else if (typeof item === 'boolean' || typeof item === 'string') output[key] = item;
  }
  return output;
}

function normalizeFfs(value: unknown): AlignmentFfsState | null {
  if (!isRecord(value)) return null;
  const sessionId = text(value.sessionId);
  if (sessionId === null) return null;
  return {
    sessionId,
    createdAt: text(value.createdAt),
    featureCount: counter(value.featureCount),
    summary: normalizeSummary(value.summary),
    sessionCount: Math.max(1, counter(value.sessionCount)),
  };
}

export function normalizeAlignmentRegistryRow(value: unknown): AlignmentRegistryRow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (id === null) return null;

  const runs = isRecord(value.runs) ? value.runs : {};
  const result = isRecord(value.result) ? value.result : {};
  const review = isRecord(value.review) ? value.review : {};
  const status = text(value.status) ?? 'unknown';
  const stage = typeof value.stage === 'string' && STAGES.has(value.stage)
    ? value.stage as AlignmentStage
    : 'running';

  return {
    id,
    pipelineId: finite(value.pipelineId),
    pipelineName: text(value.pipelineName) ?? `Run ${id}`,
    algorithm: text(value.algorithm),
    status,
    startedAt: text(value.startedAt),
    completedAt: text(value.completedAt),
    matchRate: finite(value.matchRate),
    anomaliesFound: counter(value.anomaliesFound),
    runs: { old: normalizeRunSide(runs.old), new: normalizeRunSide(runs.new) },
    result: { available: result.available === true, completedAt: text(result.completedAt) },
    review: {
      reviewedCount: counter(review.reviewedCount),
      selectedCount: counter(review.selectedCount),
    },
    ffs: normalizeFfs(value.ffs),
    stage,
  };
}

export function normalizeAlignmentRegistry(value: unknown): AlignmentRegistryRow[] {
  const items = isRecord(value) && Array.isArray(value.items)
    ? value.items
    : Array.isArray(value) ? value : [];
  return items
    .map(normalizeAlignmentRegistryRow)
    .filter((row): row is AlignmentRegistryRow => row !== null);
}

/**
 * What this row offers, as one description the table renders.
 *
 * The FFS action is the point of this function. The old table put an "FFS"
 * button on every row regardless of state, and every one of them led to the
 * setup form — including on rows that already had a filed assessment, which was
 * the only way to reach it and quietly produced a second assessment of the same
 * features. There are two different actions here and the row now shows whichever
 * one it actually has.
 */
export interface AlignmentRowPresentation {
  label: string;
  note: string;
  tone: 'idle' | 'progress' | 'ready' | 'assessed' | 'failed';
  /** Where to open the alignment result, or null while there is nothing to open. */
  resultHref: string | null;
  /** Present only when an assessment has been filed. */
  openFfsHref: string | null;
  /** Present only when one has not, and the result is there to assess. */
  runFfsHref: string | null;
}

export function presentAlignmentRow(row: AlignmentRegistryRow): AlignmentRowPresentation {
  const sessionId = encodeURIComponent(row.id);
  const resultHref = row.result.available ? `/ili-comparison?sessionId=${sessionId}` : null;

  const stages: Record<AlignmentStage, { label: string; note: string; tone: AlignmentRowPresentation['tone'] }> = {
    running: { label: 'Alignment running', note: 'The engine has not finished this session', tone: 'progress' },
    failed: { label: 'Alignment failed', note: 'No result was produced', tone: 'failed' },
    aligned: { label: 'Aligned', note: 'Result ready to review or assess', tone: 'ready' },
    released: {
      label: 'Released to FFS',
      note: `${row.review.selectedCount.toLocaleString()} feature(s) released, not yet assessed`,
      tone: 'ready',
    },
    assessed: {
      label: 'FFS assessed',
      note: row.ffs === null
        ? 'Assessment filed'
        : `${row.ffs.featureCount.toLocaleString()} feature(s) assessed in session ${row.ffs.sessionId}`,
      tone: 'assessed',
    },
  };

  return {
    ...stages[row.stage],
    resultHref,
    openFfsHref: row.ffs === null ? null : `/ffs/results?ffsSessionId=${encodeURIComponent(row.ffs.sessionId)}`,
    // Assessing needs a result to assess. A review is not required — FFS can
    // cover every anomaly the run reported.
    runFfsHref: row.ffs === null && row.result.available ? `/ffs?sessionId=${sessionId}` : null,
  };
}

/** Portfolio counters shown above the table. */
export function summarizeAlignmentRegistry(rows: readonly AlignmentRegistryRow[]) {
  return {
    total: rows.length,
    assessed: rows.filter((row) => row.stage === 'assessed').length,
    awaitingAssessment: rows.filter((row) => row.stage === 'aligned' || row.stage === 'released').length,
    running: rows.filter((row) => row.stage === 'running').length,
    anomalies: rows.reduce((sum, row) => sum + row.anomaliesFound, 0),
  };
}
