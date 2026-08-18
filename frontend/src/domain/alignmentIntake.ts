export interface IngestionFeatureCounts {
  total?: unknown;
  anomalies?: unknown;
  welds?: unknown;
  valves?: unknown;
  tees?: unknown;
  offtakes?: unknown;
  bends?: unknown;
  others?: unknown;
  gw_anchors?: unknown;
  invalid_anchor_distances?: unknown;
}

export interface IngestionResponse {
  pipeline_run_id?: unknown;
  jobId?: unknown;
  state?: string;
  progress?: unknown;
  errorMessage?: string | null;
  result?: {
    pipelineRunId?: unknown;
    summary?: IngestionFeatureCounts;
    audit?: { feature_counts?: IngestionFeatureCounts; accepted_rows?: unknown };
  } | null;
  run_summary?: IngestionFeatureCounts;
  audit?: {
    accepted_rows?: unknown;
    feature_counts?: IngestionFeatureCounts;
  };
}

export interface PersistedIliRun {
  runId: number;
  name: string;
  vendor: string;
  year: string;
  /**
   * The day the tool ran, `YYYY-MM-DD`, when the intake collected one. Empty
   * for a run imported before the intake asked, where only the year is known.
   * FFS reads this to date its assessment instead of asking the engineer to
   * retype what the upload already recorded.
   */
  surveyDate: string;
  tool: string;
  total: number;
  anomalies: number;
  welds: number;
  valves: number;
  tees: number;
  offtakes: number;
  bends: number;
  others: number;
  gwAnchors: number;
  invalidAnchorDistances: number;
}

export interface PersistedInspectionDataset<TFile = unknown> {
  file: TFile;
  vendor: string;
  year: string;
  /** `YYYY-MM-DD` when the operator supplied one; omitted for year-only runs. */
  surveyDate?: string;
  tool: string;
}

export interface RunPair {
  oldRun: PersistedIliRun;
  newRun: PersistedIliRun;
}

export interface PersistedInspectionRunPair {
  masterRun: PersistedIliRun;
  historicalRuns: PersistedIliRun[];
  newRun: PersistedIliRun;
  oldRun: PersistedIliRun;
  runPairs: RunPair[];
}

function nonNegativeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function asRunId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('Server ingestion did not return a valid run id.');
  }
  return parsed;
}

/**
 * A run's position in time, as a sortable number.
 *
 * The day wins where the intake recorded one: two runs flown in the same year
 * are a real chain that ordering by year alone resolves arbitrarily, which puts
 * the wrong run on the OLD side of a pair. Runs with only a year sort to
 * mid-year so they interleave sensibly with dated ones rather than always
 * landing first.
 */
export function runChronology(run: { year?: unknown; surveyDate?: unknown }): number {
  const date = String(run.surveyDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const year = Number(run.year);
  if (!Number.isFinite(year)) return 0;
  return Date.UTC(year, 6, 1);
}

export function buildPersistedIliRun(
  response: IngestionResponse,
  input: { name: string; vendor: string; year: string; surveyDate?: string; tool: string },
): PersistedIliRun {
  const counts = response.run_summary
    ?? response.result?.summary
    ?? response.audit?.feature_counts
    ?? response.result?.audit?.feature_counts
    ?? {};
  const total = nonNegativeCount(
    counts.total
      ?? response.audit?.accepted_rows
      ?? response.result?.audit?.accepted_rows,
  );

  return {
    runId: asRunId(response.pipeline_run_id ?? response.result?.pipelineRunId),
    name: input.name,
    vendor: input.vendor,
    year: input.year,
    surveyDate: input.surveyDate ?? '',
    tool: input.tool,
    total,
    anomalies: nonNegativeCount(counts.anomalies),
    welds: nonNegativeCount(counts.welds),
    valves: nonNegativeCount(counts.valves),
    tees: nonNegativeCount(counts.tees),
    offtakes: nonNegativeCount(counts.offtakes),
    bends: nonNegativeCount(counts.bends),
    others: nonNegativeCount(counts.others),
    gwAnchors: nonNegativeCount(counts.gw_anchors),
    invalidAnchorDistances: nonNegativeCount(counts.invalid_anchor_distances),
  };
}

export interface IngestionFileProgress {
  name: string;
  /** Server-reported completion of that one file, 0-100. */
  percent: number;
}

/**
 * One line describing an intake that imports every selected run at once.
 *
 * The uploader used to write a label per file from whichever status poll
 * answered last, so a two-run intake showed "Processing <first file>: 100%"
 * while the second run was still at 20 % — an import that looks finished and
 * hung at the same time. The figure reported here covers the whole intake, and
 * names how many runs are already in.
 */
export function describeIngestionProgress(files: IngestionFileProgress[]): string {
  if (files.length === 0) return '';
  const measured = files.map((file) => (Number.isFinite(file.percent) ? file.percent : 0));
  const overall = Math.floor(measured.reduce((sum, percent) => sum + percent, 0) / files.length);
  if (files.length === 1) return `Processing ${files[0].name}: ${overall}%`;
  const imported = measured.filter((percent) => percent >= 100).length;
  return `Processing ${files.length} runs: ${overall}% (${imported} of ${files.length} imported)`;
}

export async function ingestPersistedInspectionRunPair<TFile>({
  datasets,
  masterIndex,
  ingest,
}: {
  datasets: PersistedInspectionDataset<TFile>[];
  masterIndex: number;
  ingest: (dataset: PersistedInspectionDataset<TFile>, index: number) => Promise<PersistedIliRun>;
}): Promise<PersistedInspectionRunPair> {
  if (!Number.isInteger(masterIndex) || masterIndex < 0 || masterIndex >= datasets.length) {
    throw new Error('Select one uploaded inspection run as the master run.');
  }

  const runs = await Promise.all(datasets.map(async (dataset, index) => {
    const run = await ingest(dataset, index);
    if (!Number.isSafeInteger(run.runId) || run.runId < 1) {
      throw new Error('Server ingestion did not persist an inspection run.');
    }
    return run;
  }));

  const masterRun = runs[masterIndex];
  const historicalRuns = runs
    .filter((_run, index) => index !== masterIndex)
    .sort((left, right) => runChronology(right) - runChronology(left));
  const oldRun = historicalRuns[0];
  if (!masterRun || !oldRun) {
    throw new Error('One persisted master run and one persisted historical run are required.');
  }

  // Build pairwise chain in survey order, oldest first
  const sorted = [...runs].sort((a, b) => runChronology(a) - runChronology(b));
  const runPairs: RunPair[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    runPairs.push({ oldRun: sorted[i], newRun: sorted[i + 1] });
  }

  return { masterRun, historicalRuns, newRun: masterRun, oldRun, runPairs };
}
