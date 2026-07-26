// Star topology for sessions holding more than two inspection runs.
//
// Chain alignment links consecutive runs, which makes every link depend on the
// weakest run in the middle: one sparse or partial inspection breaks the trail
// for every year after it. Corrosion growth needs the opposite property, so
// here every historical run is anchored directly to a single reference run and
// a bad run can only spoil itself.
//
// A two-run session produces exactly one pair either way, so this module is a
// superset of the pairwise behaviour rather than a replacement for it.

// Explicit extension so `node --test` resolves this the same way Vite does.
import { runPairKey, type RunPairRef } from './runPairs.ts';

export interface InspectionRun {
  runId: number;
  year: number | null;
  raw: any;
  label: string;
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseYear(run: any): number | null {
  const parsed = Number(run?.year ?? run?.surveyYear);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every persisted inspection run in a session, oldest first.
 *
 * Runs are gathered from every shape the wizard has ever written — the run-pair
 * chain, master/historical fields, and the phylogenetic run1..runN slots — so a
 * session saved by any client version resolves the same set.
 */
export function resolveInspectionRuns(summaryData: any): InspectionRun[] {
  const seen = new Map<number, any>();
  const remember = (run: any) => {
    const runId = parsePositiveId(run?.runId);
    if (runId !== null && !seen.has(runId)) seen.set(runId, run);
  };

  for (const pair of Array.isArray(summaryData?.runPairs) ? summaryData.runPairs : []) {
    remember(pair?.oldRun);
    remember(pair?.newRun);
  }
  remember(summaryData?.masterRun);
  remember(summaryData?.newRun);
  remember(summaryData?.oldRun);
  for (const run of Array.isArray(summaryData?.historicalRuns) ? summaryData.historicalRuns : []) {
    remember(run);
  }
  remember(summaryData?.ancestorRun);
  for (let index = 1; index <= 20; index += 1) remember(summaryData?.[`run${index}`]);

  return [...seen.entries()]
    .map(([runId, raw]) => ({
      runId,
      year: parseYear(raw),
      raw,
      label: String(raw?.year ?? raw?.surveyYear ?? runId),
    }))
    // Undated runs sort last rather than pretending to be the oldest, which
    // would let one of them become the reference by accident.
    .sort((left, right) => (left.year ?? Infinity) - (right.year ?? Infinity) || left.runId - right.runId);
}

/** A session comparing more than two inspections needs the stacked treatment. */
export function isMultiRunSession(summaryData: any): boolean {
  return resolveInspectionRuns(summaryData).length > 2;
}

/**
 * The run every other run is measured against.
 *
 * The newest run is the default because growth analysis is about the defects
 * that exist now, but the caller may override it: when the newest inspection is
 * a short partial run, anchoring to it would discard every kilometre it never
 * covered.
 */
export function resolveReferenceRun(summaryData: any, preferredRunId?: unknown): InspectionRun | null {
  const runs = resolveInspectionRuns(summaryData);
  if (runs.length === 0) return null;
  const preferred = parsePositiveId(preferredRunId);
  if (preferred !== null) {
    const chosen = runs.find((run) => run.runId === preferred);
    if (chosen) return chosen;
  }
  return runs[runs.length - 1];
}

/**
 * One pair per historical run, each pointing at the reference run.
 *
 * Ordering follows the run order so the stacked lanes read chronologically.
 */
export function resolveStarRunPairs(summaryData: any, preferredReferenceRunId?: unknown): RunPairRef[] {
  const reference = resolveReferenceRun(summaryData, preferredReferenceRunId);
  if (!reference) return [];
  return resolveInspectionRuns(summaryData)
    .filter((run) => run.runId !== reference.runId)
    .flatMap((run) => {
      const key = runPairKey(run.runId, reference.runId);
      if (!key) return [];
      return [{
        key,
        oldRunId: run.runId,
        newRunId: reference.runId,
        oldRun: run.raw,
        newRun: reference.raw,
        label: `${run.label} → ${reference.label}`,
      }];
    });
}
