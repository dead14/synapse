import { pairKey } from './pairing.ts';
import type { HistoricalGwLane, SpatialFeature } from './types';

type AlignmentMatch = Record<string, unknown>;
type HistoricalRun = Record<string, unknown>;
type ComparisonRow = Record<string, unknown>;

export function parseWallThicknessMm(rawData: Record<string, unknown> | undefined): number | null {
  if (!rawData) return null;
  const preferredKeys = [
    'wall_thickness_mm',
    'wall thickness mm',
    'wall thickness',
    'nominal wall thickness',
    'nominal wall thickness mm',
    'wt',
    'wt mm',
    'wall wt new (mm)',
    'wall wt old (mm)',
  ];
  for (const [key, value] of Object.entries(rawData)) {
    const normalizedKey = key.toLowerCase().replaceAll('_', ' ').trim();
    if (!preferredKeys.some((candidate) => normalizedKey === candidate || normalizedKey.includes(candidate))) continue;
    const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function historicalType(row: ComparisonRow) {
  return String(row.type ?? row.originalType ?? row['Feature Type OLD'] ?? '').toLowerCase();
}

function historicalDistance(row: ComparisonRow) {
  return Number(row.dist ?? row.odometer ?? row.distance ?? row.val ?? row['Log Dist OLD (m)']);
}

function historicalId(row: ComparisonRow, fallback: string) {
  return String(row.id ?? row['Identif. OLD'] ?? fallback);
}

export function displayDistanceOnMaster(feature: SpatialFeature) {
  const masterDistance = Number(feature.rawData.masterDistance);
  return Number.isFinite(masterDistance) ? masterDistance : feature.dist;
}

function lockedOldGw(match: AlignmentMatch, run: HistoricalRun): SpatialFeature | null {
  const id = String(match.old_id ?? match.oldId ?? '');
  const dist = Number(match.old_odometer ?? match.oldVal ?? match.oldDist);
  const masterDistance = Number(match.new_odometer ?? match.newVal ?? match.newDist);
  if (!id || !Number.isFinite(dist) || !Number.isFinite(masterDistance)) return null;
  return {
    id,
    dist,
    type: 'weld',
    runRole: 'HISTORICAL',
    runYear: String(run.year ?? ''),
    status: 'MATCHED',
    wallThicknessMm: null,
    rawData: {
      sourceDistance: dist,
      masterDistance,
      matchedMasterId: String(match.new_id ?? match.newId ?? ''),
    },
    lat: Number.NaN,
    lng: Number.NaN,
  };
}

export function buildHistoricalLanes(
  historicalRuns: unknown,
  matches: AlignmentMatch[],
  comparisonRows: ComparisonRow[],
): HistoricalGwLane[] {
  const matchByOld = new Map(matches.map((match) => [
    pairKey(
      String(match.old_id ?? match.oldId ?? ''),
      Number(match.old_odometer ?? match.oldVal ?? match.oldDist),
    ),
    match,
  ]));
  const runs = Array.isArray(historicalRuns) ? historicalRuns as HistoricalRun[] : [];

  return runs.map((run, runIndex) => {
    const rawFeatures = Array.isArray(run.rawFeatures) ? run.rawFeatures as ComparisonRow[] : [];
    // Persisted run summaries intentionally omit rawFeatures. The primary OLD
    // run is still available in the saved comparison result under OLD columns.
    const rows = rawFeatures.length > 0 || runIndex > 0 ? rawFeatures : comparisonRows;
    const gwsFromRows = rows
      .filter((row) => /weld|girth|seam|gw/.test(historicalType(row)))
      .map((row, rowIndex): SpatialFeature | null => {
        const dist = historicalDistance(row);
        if (!Number.isFinite(dist)) return null;
        const id = historicalId(row, `OLD-${runIndex + 1}-${rowIndex + 1}`);
        const matched = matchByOld.get(pairKey(id, dist));
        const hasNewPartner = Boolean(matched && (matched.new_id ?? matched.newId));
        const masterDistance = Number(matched?.new_odometer ?? matched?.newVal ?? matched?.newDist);
        return {
          id,
          dist,
          type: historicalType(row) || 'weld',
          runRole: 'HISTORICAL',
          runYear: String(run.year ?? ''),
          status: runIndex === 0 ? (hasNewPartner ? 'MATCHED' : 'MISSING_IN_MASTER') : 'UNRESOLVED',
          wallThicknessMm: parseWallThicknessMm(row),
          rawData: {
            ...row,
            sourceDistance: dist,
            masterDistance: Number.isFinite(masterDistance) ? masterDistance : undefined,
            matchedMasterId: matched?.new_id ?? matched?.newId,
          },
          lat: Number.NaN,
          lng: Number.NaN,
        };
      })
      .filter((feature): feature is SpatialFeature => feature !== null)
      .sort((left, right) => left.dist - right.dist);
    const lockedGws = matches
      .map((match) => lockedOldGw(match, run))
      .filter((feature): feature is SpatialFeature => feature !== null);
    const lockedKeys = new Set(lockedGws.map((feature) => pairKey(feature.id, feature.dist)));
    const gws = runIndex > 0
      ? gwsFromRows
      : [
        ...lockedGws,
        ...gwsFromRows.filter((feature) => !lockedKeys.has(pairKey(feature.id, feature.dist))),
      ].sort((left, right) => left.dist - right.dist);

    const bends = rows
      .filter((row) => historicalType(row).includes('bend'))
      .map((row, rowIndex): SpatialFeature | null => {
        const dist = historicalDistance(row);
        if (!Number.isFinite(dist)) return null;
        return {
          id: historicalId(row, `OLD-BEND-${runIndex + 1}-${rowIndex + 1}`),
          dist,
          type: historicalType(row) || 'bend',
          runRole: 'HISTORICAL',
          runYear: String(run.year ?? ''),
          status: 'UNRESOLVED',
          rawData: { ...row },
          lat: Number.NaN,
          lng: Number.NaN,
        };
      })
      .filter((feature): feature is SpatialFeature => feature !== null)
      .sort((left, right) => left.dist - right.dist);

    return {
      id: `history-${runIndex}`,
      label: String(run.name ?? `Historical ${runIndex + 1}`),
      year: String(run.year ?? ''),
      gws,
      bends,
    };
  });
}
