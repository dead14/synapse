export type SectioningAnchorPage = {
  items?: unknown;
  nextCursor?: unknown;
};

type SectioningTieInEvidence = {
  globalOffset?: unknown;
  tieInTransform?: {
    direction?: unknown;
  } | null;
  tieInDecision?: {
    status?: unknown;
  } | null;
} | null | undefined;

type FetchAnchorPage = (
  path: string,
  signal: AbortSignal,
) => Promise<SectioningAnchorPage>;

const finiteNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function prepareSectioningMasterRows(
  rows: unknown,
  tieIn: SectioningTieInEvidence,
): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return [];
  const decisionStatus = String(tieIn?.tieInDecision?.status ?? '');
  const hasCanonicalTieIn = tieIn?.tieInTransform?.direction === 'OLD_TO_NEW'
    && (decisionStatus === 'AUTO_ACCEPTED' || decisionStatus === 'REVIEW_ACKNOWLEDGED');
  const legacyOffset = hasCanonicalTieIn ? 0 : finiteNumber(tieIn?.globalOffset) ?? 0;

  return rows.flatMap((candidate): Array<Record<string, unknown>> => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const raw = row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
      ? row.raw as Record<string, unknown>
      : {};
    const sourceDistance = [
      row.source_log_distance_m,
      row.sourceDist,
      row.sourceDistanceM,
      row.source_abs_distance_m,
      raw.source_log_distance_m,
      raw.sourceDist,
      raw.sourceDistanceM,
      raw.log_distance_m,
      row.log_distance_m,
      row.dist,
    ].map(finiteNumber).find((value) => value !== null) ?? null;
    if (sourceDistance === null) return [row];

    // `abs_distance_m` is ambiguous in legacy payloads: some producers used it
    // for source LD and others for a mapped coordinate. Only names that state
    // plot/aligned provenance are safe to trust without applying the pair offset.
    const existingPlotPosition = [
      row.plot_distance_m,
      row.aligned_distance_m,
      row.alignedDist,
    ].map(finiteNumber).find((value) => value !== null) ?? null;
    const plotPosition = existingPlotPosition ?? sourceDistance + legacyOffset;

    return [{
      ...row,
      dist: plotPosition,
      plot_distance_m: plotPosition,
      source_log_distance_m: sourceDistance,
      raw: {
        ...raw,
        log_distance_m: sourceDistance,
      },
    }];
  });
}

export async function fetchSectioningAnchors(
  runId: number,
  signal: AbortSignal,
  fetchPage: FetchAnchorPage,
): Promise<any[]> {
  if (!Number.isSafeInteger(runId) || runId < 1) {
    throw new Error('A valid inspection run id is required.');
  }

  const rows: any[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '5000' });
    if (cursor) query.set('cursor', cursor);
    const page = await fetchPage(
      `/api/inspection-runs/${runId}/anchors?${query.toString()}`,
      signal,
    );
    if (Array.isArray(page.items)) rows.push(...page.items);
    cursor = typeof page.nextCursor === 'string' && page.nextCursor.length > 0
      ? page.nextCursor
      : null;
  } while (cursor);

  return rows;
}
