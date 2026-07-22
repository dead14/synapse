export type SectioningAnchorPage = {
  items?: unknown;
  nextCursor?: unknown;
};

type FetchAnchorPage = (
  path: string,
  signal: AbortSignal,
) => Promise<SectioningAnchorPage>;

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
