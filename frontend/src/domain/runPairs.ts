// Chain alignment compares N inspection runs as N-1 consecutive pairs. Tie-in,
// GW matching, sectioning, and results each need their own evidence per pair, so
// they all file it under the key built here. The backend mirrors this format in
// `backend/src/modules/alignment/runPairIdentity.js` — the two must stay
// byte-identical or the wizard and the engines will disagree about which pair a
// stored transform belongs to.

export interface RunPairRef {
  key: string;
  oldRunId: number;
  newRunId: number;
  oldRun: any;
  newRun: any;
  label: string;
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function runPairKey(oldRunId: unknown, newRunId: unknown): string | null {
  const oldId = parsePositiveId(oldRunId);
  const newId = parsePositiveId(newRunId);
  return oldId && newId ? `${oldId}->${newId}` : null;
}

export function pairKeyOf(pair: any): string | null {
  return runPairKey(pair?.oldRun?.runId ?? pair?.oldRunId, pair?.newRun?.runId ?? pair?.newRunId);
}

function runYear(run: any): number | null {
  const parsed = Number(run?.year ?? run?.surveyYear);
  return Number.isFinite(parsed) ? parsed : null;
}

function pairLabel(oldRun: any, newRun: any): string {
  return `${oldRun?.year || '?'} → ${newRun?.year || '?'}`;
}

/**
 * Every run pair this session aligns, oldest transition first. Sessions saved
 * before chain alignment existed only carry `oldRun`/`newRun`, so they degrade
 * to a single pair instead of rendering an empty workspace.
 */
export function resolveRunPairs(summaryData: any): RunPairRef[] {
  const stored = Array.isArray(summaryData?.runPairs) ? summaryData.runPairs : [];
  const pairs: RunPairRef[] = [];
  const seen = new Set<string>();

  for (const pair of stored) {
    const oldRunId = parsePositiveId(pair?.oldRun?.runId);
    const newRunId = parsePositiveId(pair?.newRun?.runId);
    const key = runPairKey(oldRunId, newRunId);
    if (!key || oldRunId === newRunId || seen.has(key)) continue;
    seen.add(key);
    pairs.push({
      key,
      oldRunId: oldRunId as number,
      newRunId: newRunId as number,
      oldRun: pair.oldRun,
      newRun: pair.newRun,
      label: pairLabel(pair.oldRun, pair.newRun),
    });
  }
  if (pairs.length > 0) return pairs;

  const oldRunId = parsePositiveId(summaryData?.oldRun?.runId);
  const newRunId = parsePositiveId(summaryData?.newRun?.runId);
  const key = runPairKey(oldRunId, newRunId);
  if (!key || oldRunId === newRunId) return [];
  return [{
    key,
    oldRunId: oldRunId as number,
    newRunId: newRunId as number,
    oldRun: summaryData.oldRun,
    newRun: summaryData.newRun,
    label: pairLabel(summaryData.oldRun, summaryData.newRun),
  }];
}

/**
 * The pair that owns the session's unscoped, top-level evidence. Single-pair and
 * legacy sessions keep reading `config.gwMatchesFinal` / `config.tieInTransform`
 * from the root, and it is the last transition into the master run that those
 * describe.
 */
export function primaryRunPair(summaryData: any): RunPairRef | null {
  const pairs = resolveRunPairs(summaryData);
  if (pairs.length === 0) return null;
  const masterRunId = parsePositiveId(summaryData?.masterRun?.runId)
    ?? parsePositiveId(summaryData?.newRun?.runId);
  if (masterRunId) {
    const intoMaster = pairs.filter((pair) => pair.newRunId === masterRunId);
    if (intoMaster.length > 0) {
      return intoMaster.reduce((latest, pair) => (
        (runYear(pair.oldRun) ?? -Infinity) > (runYear(latest.oldRun) ?? -Infinity) ? pair : latest
      ));
    }
  }
  return pairs[pairs.length - 1];
}

/**
 * Per-pair tie-in evidence, falling back to the top-level fields so a session
 * saved by an older client still resolves its primary pair.
 */
export function pairTieIn(config: any, pair: RunPairRef | null): any {
  const scoped = pair ? config?.pairTieIns?.[pair.key] : undefined;
  if (scoped) return scoped;
  const primary = primaryRunPair(config?.summaryData);
  if (pair && primary && pair.key !== primary.key) return null;
  return {
    globalOffset: config?.globalOffset,
    tieInMetrics: config?.tieInMetrics,
    tieInEvidenceToken: config?.tieInEvidenceToken,
    tieInMethodVersion: config?.tieInMethodVersion,
    tieInTransform: config?.tieInTransform,
    tieInDecision: config?.tieInDecision,
    tieInExcludedRanges: config?.tieInExcludedRanges,
  };
}

/**
 * Per-pair GW matching evidence, with the same top-level fallback as
 * {@link pairTieIn}.
 */
export function pairGwResult(config: any, pair: RunPairRef | null): any {
  const scoped = pair ? config?.pairGwResults?.[pair.key] : undefined;
  if (scoped) return scoped;
  const primary = primaryRunPair(config?.summaryData);
  if (pair && primary && pair.key !== primary.key) return null;
  return {
    gwMatchesFinal: config?.gwMatchesFinal,
    gwOrphans: config?.gwOrphans,
    gwReview: config?.gwReview,
    gwReviewSignature: config?.gwReviewSignature,
    ota: config?.ota,
    strictPenalty: config?.strictPenalty,
    useValveAnchor: config?.useValveAnchor,
    dtwOn: config?.dtwOn,
  };
}

/** Sections belonging to one pair. Sections saved before pair scoping existed
 * carry no `pairKey` and are treated as the primary pair's. */
export function sectionsForPair<T extends { pairKey?: string }>(
  sections: T[] | undefined,
  pair: RunPairRef | null,
  primary: RunPairRef | null,
): T[] {
  if (!Array.isArray(sections) || !pair) return [];
  return sections.filter((section) => (
    section.pairKey ? section.pairKey === pair.key : pair.key === primary?.key
  ));
}
