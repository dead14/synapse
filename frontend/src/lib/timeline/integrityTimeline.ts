export type GenealogyStatus = 'matched' | 'new' | 'disappeared' | 'split' | 'merge' | 'overridden';

export interface TimelineObservation {
  runId: string;
  runDate: string;
  featureKey: string;
  genealogyKey: string;
  chainageM: number;
  depthPct: number;
  lengthMm: number;
  widthMm: number;
  measurementTolerancePct: number;
  alignmentConfidence: number;
  matchConfidence: number;
  relation?: 'one-to-one' | 'split' | 'merge';
  overrideReason?: string;
}

export interface IntegrityGenealogy {
  genealogyKey: string;
  status: GenealogyStatus;
  observations: TimelineObservation[];
  growth: null | {
    elapsedYears: number;
    depthPctDelta: number;
    lengthMmDelta: number;
    widthMmDelta: number;
    depthPctPerYear: number;
  };
  confidence: {
    alignment: number;
    match: number;
    measurement: number;
    growth: number;
    overall: number;
  };
}

export interface IntegrityTimeline {
  runIds: string[];
  genealogies: IntegrityGenealogy[];
}

function finite(value: number, field: string) {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
}

function fraction(value: number, field: string) {
  finite(value, field);
  if (value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
  return value;
}

function observationDate(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('runDate must be a valid date');
  return time;
}

function minimum(values: number[]) {
  return values.reduce((result, value) => Math.min(result, value), 1);
}

function statusFor(
  observations: TimelineObservation[],
  firstRunId: string,
  lastRunId: string,
): GenealogyStatus {
  if (observations.some((item) => item.overrideReason)) return 'overridden';
  if (observations.some((item) => item.relation === 'split')) return 'split';
  if (observations.some((item) => item.relation === 'merge')) return 'merge';
  if (observations.length === 1 && observations[0].runId === lastRunId) return 'new';
  if (observations.length === 1 && observations[0].runId === firstRunId) return 'disappeared';
  return 'matched';
}

export function buildIntegrityTimeline(input: TimelineObservation[]): IntegrityTimeline {
  if (input.length === 0) return { runIds: [], genealogies: [] };

  const featureKeys = new Set<string>();
  const runDates = new Map<string, number>();
  const groups = new Map<string, TimelineObservation[]>();

  for (const item of input) {
    if (!item.runId || !item.featureKey || !item.genealogyKey) {
      throw new Error('runId, featureKey, and genealogyKey are required');
    }
    if (featureKeys.has(item.featureKey)) throw new Error(`duplicate featureKey: ${item.featureKey}`);
    featureKeys.add(item.featureKey);
    finite(item.chainageM, 'chainageM');
    finite(item.depthPct, 'depthPct');
    finite(item.lengthMm, 'lengthMm');
    finite(item.widthMm, 'widthMm');
    finite(item.measurementTolerancePct, 'measurementTolerancePct');
    fraction(item.alignmentConfidence, 'alignmentConfidence');
    fraction(item.matchConfidence, 'matchConfidence');
    const date = observationDate(item.runDate);
    const existingRunDate = runDates.get(item.runId);
    if (existingRunDate !== undefined && existingRunDate !== date) {
      throw new Error(`runId ${item.runId} has conflicting dates`);
    }
    runDates.set(item.runId, date);
    groups.set(item.genealogyKey, [...(groups.get(item.genealogyKey) ?? []), { ...item }]);
  }

  const runIds = [...runDates.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([runId]) => runId);
  const firstRunId = runIds[0];
  const lastRunId = runIds.at(-1) as string;

  const genealogies = [...groups.entries()].map(([genealogyKey, rawObservations]) => {
    const observations = rawObservations.sort(
      (left, right) => observationDate(left.runDate) - observationDate(right.runDate),
    );
    const first = observations[0];
    const last = observations.at(-1) as TimelineObservation;
    const elapsedYears = (observationDate(last.runDate) - observationDate(first.runDate))
      / (365.25 * 24 * 60 * 60 * 1000);
    const tolerance = minimum(observations.map((item) => Math.max(0, 1 - item.measurementTolerancePct / 100)));
    const alignment = minimum(observations.map((item) => item.alignmentConfidence));
    const match = minimum(observations.map((item) => item.matchConfidence));
    const growth = observations.length > 1 && elapsedYears > 0
      ? {
          elapsedYears,
          depthPctDelta: last.depthPct - first.depthPct,
          lengthMmDelta: last.lengthMm - first.lengthMm,
          widthMmDelta: last.widthMm - first.widthMm,
          depthPctPerYear: (last.depthPct - first.depthPct) / elapsedYears,
        }
      : null;
    const growthConfidence = growth ? minimum([alignment, match, tolerance]) : 0;

    return {
      genealogyKey,
      status: statusFor(observations, firstRunId, lastRunId),
      observations,
      growth,
      confidence: {
        alignment,
        match,
        measurement: tolerance,
        growth: growthConfidence,
        overall: minimum([alignment, match, tolerance]),
      },
    } satisfies IntegrityGenealogy;
  });

  return {
    runIds,
    genealogies: genealogies.sort((left, right) => {
      const leftChainage = left.observations.at(-1)?.chainageM ?? 0;
      const rightChainage = right.observations.at(-1)?.chainageM ?? 0;
      return leftChainage - rightChainage || left.genealogyKey.localeCompare(right.genealogyKey);
    }),
  };
}
