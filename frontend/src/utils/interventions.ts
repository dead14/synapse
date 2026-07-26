import type { ComparisonRow } from './alignment';

export interface InterventionEvent {
  id: string;
  type: 'REASSIGN_NEW';
  sourceNewKey: string;
  targetOldKey: string;
  evidenceScore: number;
  createdAt?: string;
}

const present = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== '-';

export function applyInterventions(
  sourceRows: ComparisonRow[],
  events: InterventionEvent[],
): ComparisonRow[] {
  const rows = sourceRows.map((row) => ({ ...row }));

  for (const event of events) {
    if (event.type !== 'REASSIGN_NEW') continue;
    const source = rows.find((row) => String(row['Source Key NEW'] || '') === event.sourceNewKey);
    const target = rows.find((row) => String(row['Source Key OLD'] || '') === event.targetOldKey);
    if (!source || !target || source === target) continue;
    // Never overwrite another NEW feature.  A second explicit event is needed
    // to move that identity first, preserving one-source/one-output semantics.
    if (present(target['Source Key NEW'])) continue;

    const payload = Object.fromEntries(
      Object.entries(source).filter(([key]) => key.includes('NEW') || key === "O'Clock NEW"),
    );
    for (const [key, value] of Object.entries(payload)) {
      target[key] = value;
      source[key] = typeof value === 'number' ? Number.NaN : '-';
    }
    target['Match/Unmatch'] = 'Match';
    target['Intervention ID'] = event.id;
    target['Evidence Score'] = event.evidenceScore;
  }

  return rows.filter((row) => present(row['Identif. OLD']) || present(row['Identif. NEW']));
}
