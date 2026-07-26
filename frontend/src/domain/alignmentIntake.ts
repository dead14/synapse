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

export function buildPersistedIliRun(
  response: IngestionResponse,
  input: { name: string; vendor: string; year: string; tool: string },
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
    .sort((left, right) => Number(right.year || 0) - Number(left.year || 0));
  const oldRun = historicalRuns[0];
  if (!masterRun || !oldRun) {
    throw new Error('One persisted master run and one persisted historical run are required.');
  }

  // Build pairwise chain sorted by year ascending
  const sorted = [...runs].sort(
    (a, b) => Number(a.year || 0) - Number(b.year || 0),
  );
  const runPairs: RunPair[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    runPairs.push({ oldRun: sorted[i], newRun: sorted[i + 1] });
  }

  return { masterRun, historicalRuns, newRun: masterRun, oldRun, runPairs };
}
