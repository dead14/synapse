/**
 * One lane per inspection run, built from the alignment comparison rows.
 *
 * The results table is pair-shaped: every row holds an OLD side and a NEW side.
 * A chain of N runs is therefore N-1 pair blocks, and the same physical run
 * appears twice — as the NEW side of one pair and the OLD side of the next.  A
 * reviewer reading a tally comparison does not think in pairs, they think in
 * runs: "where was this metal loss in 2018, in 2021, in 2024".  This module
 * folds the pair rows back into one lane per run so the viewer can draw N lanes
 * for N runs instead of a hardcoded OLD/NEW couple.
 *
 * Two distances are kept for every feature and never mixed up:
 *
 * - `rawM`   — the log distance printed in that year's own tally
 *              (`Original Log Dist …`). This is the number the vendor reported
 *              and it is what the lane shows by default. It is never derived.
 * - `alignedM` — the same feature projected onto the newest run's odometer, so
 *              lanes stack comparably. For the last pair this is the engine's
 *              own mapped value (`Log Dist …`), used verbatim. For older runs
 *              of a 3+ run chain it is composed through the intermediate pairs
 *              using their matched girth welds as anchors, and the lane is
 *              flagged `alignedIsDerived` so the UI can say so.
 */

import { parseClockToHours } from '../utils/clock.ts';
import { extentOf } from '../utils/numericRange.ts';

export type ComparisonRow = Record<string, unknown>;

export type FeatureKind = 'weld' | 'valve' | 'tee' | 'bend' | 'flange' | 'anomaly' | 'other';

export type AxisMode = 'raw' | 'aligned';

/** How a feature relates to its neighbouring runs in the chain. */
export type LaneFeatureStatus =
  | 'persistent' // paired with the previous run and with the next one
  | 'new' // absent from the previous run
  | 'lost' // absent from the next run
  | 'transient' // absent from both
  | 'single'; // this run has no neighbour to compare against

export interface LaneFeature {
  key: string;
  /** Index into the rows array handed to {@link buildComparisonLanes}. */
  rowIndex: number;
  /** Row carrying this feature as the NEW side (comparison against the older run). */
  backRowIndex: number | null;
  /** Row carrying this feature as the OLD side (comparison against the newer run). */
  forwardRowIndex: number | null;
  id: string;
  kind: FeatureKind;
  rawM: number | null;
  alignedM: number | null;
  clockHours: number | null;
  clockDeg: number | null;
  clockLabel: string;
  depthPct: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  /** Distance to the upstream girth weld as reported by the vendor. */
  usGwM: number | null;
  jointNo: string | null;
  external: boolean | null;
  featureType: string;
  matchedBack: boolean | null;
  matchedForward: boolean | null;
  status: LaneFeatureStatus;
}

export interface ComparisonLane {
  runId: string;
  label: string;
  year: number | null;
  order: number;
  /** The newest run: every other lane is aligned onto its odometer. */
  isMaster: boolean;
  features: LaneFeature[];
  /** Girth welds of this run only — never borrowed from another run. */
  gws: LaneFeature[];
  alignedAvailable: boolean;
  alignedIsDerived: boolean;
}

export interface LaneJoint {
  index: number;
  startM: number;
  endM: number;
  /** Span on the active axis, which stretches when a lane is aligned. */
  spanM: number;
  /** Girth-weld spacing in the run's own odometer — the real joint length. */
  trueLengthM: number;
  startGw: LaneFeature;
  endGw: LaneFeature;
}

export interface ComparisonLaneModel {
  lanes: ComparisonLane[];
  pairCount: number;
  /** Runs that carry no usable alignment onto the master odometer. */
  unalignedRuns: string[];
}

const MISSING = new Set(['', '-', 'nan', 'null', 'undefined']);

const KIND_PATTERNS: Array<[FeatureKind, RegExp]> = [
  ['weld', /weld|girth|\bgw\b|seam/],
  ['valve', /valve/],
  ['tee', /\btee\b|offtake|branch/],
  ['flange', /flange/],
  ['bend', /bend|elbow/],
  ['anomaly', /anomal|metal[\s_-]?loss|corros|dent|crack|lamination|gouge|pitting/],
];

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function present(value: unknown): boolean {
  const raw = text(value);
  return raw !== '' && !MISSING.has(raw.toLowerCase());
}

function num(value: unknown): number | null {
  if (!present(value)) return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyFeatureKind(featureType: string, resultGroup: string): FeatureKind {
  const haystack = featureType.toLowerCase();
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(haystack)) return kind;
  }
  return resultGroup.toUpperCase() === 'GW' ? 'weld' : 'other';
}

export function formatClockLabel(hours: number | null): string {
  if (hours === null) return '-';
  const wrapped = ((hours % 12) + 12) % 12;
  let hour = Math.floor(wrapped);
  let minute = Math.round((wrapped - hour) * 60);
  if (minute === 60) {
    minute = 0;
    hour += 1;
  }
  const displayHour = hour === 0 ? 12 : hour;
  return `${String(displayHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Monotone piecewise-linear map through the supplied anchors, extrapolating with
 * the slope of the first and last segment. Returns `null` when there is nothing
 * to interpolate with, so callers can fall back rather than invent a position.
 */
export function buildProjector(
  anchors: Array<{ from: number; to: number }>,
): ((value: number) => number) | null {
  const sorted = anchors
    .filter((anchor) => Number.isFinite(anchor.from) && Number.isFinite(anchor.to))
    .sort((left, right) => left.from - right.from);
  const froms: number[] = [];
  const tos: number[] = [];
  for (const anchor of sorted) {
    // Duplicate abscissae make the slope infinite; the last one wins.
    if (froms.length > 0 && Math.abs(froms[froms.length - 1] - anchor.from) < 1e-9) {
      tos[tos.length - 1] = anchor.to;
      continue;
    }
    froms.push(anchor.from);
    tos.push(anchor.to);
  }
  if (froms.length === 0) return null;
  if (froms.length === 1) {
    const offset = tos[0] - froms[0];
    return (value: number) => value + offset;
  }

  const interpolate = (value: number, lowIndex: number, highIndex: number) => {
    const span = froms[highIndex] - froms[lowIndex];
    if (Math.abs(span) < 1e-9) return tos[highIndex];
    const ratio = (value - froms[lowIndex]) / span;
    return tos[lowIndex] + ratio * (tos[highIndex] - tos[lowIndex]);
  };

  return (value: number) => {
    if (!Number.isFinite(value)) return value;
    if (value <= froms[0]) return interpolate(value, 0, 1);
    if (value >= froms[froms.length - 1]) return interpolate(value, froms.length - 2, froms.length - 1);
    let low = 0;
    let high = froms.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (froms[middle] <= value) low = middle;
      else high = middle;
    }
    return interpolate(value, low, high);
  };
}

interface Observation {
  rowIndex: number;
  pairIndex: number;
  side: 'old' | 'new';
  key: string;
  id: string;
  kind: FeatureKind;
  rawM: number | null;
  mappedM: number | null;
  /**
   * Set on OLD observations of matched rows: the matched NEW side's own
   * reported distance. Using it as the destination when projecting an OLD
   * feature onto the newer run makes a matched pair sit at exactly the same
   * X in the chart, which is what a reviewer means by "calibrated view".
   */
  snapM: number | null;
  clockHours: number | null;
  depthPct: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  usGwM: number | null;
  jointNo: string | null;
  external: boolean | null;
  featureType: string;
  rowMatched: boolean;
}

function sideObservation(
  row: ComparisonRow,
  rowIndex: number,
  pairIndex: number,
  side: 'old' | 'new',
  rowMatched: boolean,
): Observation | null {
  const suffix = side === 'old' ? 'OLD' : 'NEW';
  const id = text(row[`Identif. ${suffix}`] ?? row[`Feature ID ${suffix}`]);
  const mappedM = num(row[`Log Dist ${suffix} (m)`]);
  const originalM = num(row[`Original Log Dist ${suffix} (m)`]);
  const hasId = present(id);
  if (!hasId && mappedM === null && originalM === null) return null;

  const featureType = text(row[`Feature Type ${suffix}`] ?? row[`Feature Identification ${suffix}`]);
  const surface = text(row[`Int/Ext ${suffix}`] ?? row[`Surface ${suffix}`]);
  const sourceKey = text(row[`Source Key ${suffix}`]);
  const clockHours = present(row[`O'Clock ${suffix}`])
    ? parseClockToHours(row[`O'Clock ${suffix}`])
    : null;

  return {
    rowIndex,
    pairIndex,
    side,
    key: present(sourceKey) ? sourceKey : (hasId ? `id:${id}` : `row:${side}:${rowIndex}`),
    id: hasId ? id : '-',
    kind: classifyFeatureKind(featureType, text(row['Result Group'])),
    // The vendor's own odometer is the source of truth; the mapped value only
    // stands in when a run carries no original column (single-pair legacy runs
    // where the master is unshifted anyway).
    rawM: originalM ?? mappedM,
    mappedM,
    snapM: null,
    clockHours,
    depthPct: num(row[`Depth ${suffix} (%WT)`]),
    lengthMm: num(row[`Length ${suffix} (mm)`]),
    widthMm: num(row[`Width ${suffix} (mm)`]),
    usGwM: num(row[`Dist GW ${suffix} (m)`]),
    jointNo: present(row[`Joint No. ${suffix}`]) ? text(row[`Joint No. ${suffix}`]) : null,
    external: present(surface) ? surface.toUpperCase().includes('EXT') : null,
    featureType,
    rowMatched,
  };
}

function pairIndexOf(row: ComparisonRow): number {
  const parsed = Number(row.pair_index);
  return Number.isFinite(parsed) ? parsed : 0;
}

function yearOf(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1900 ? parsed : null;
}

interface PairIdentity {
  index: number;
  oldLabel: string;
  newLabel: string;
  oldYear: number | null;
  newYear: number | null;
}

function pairIdentities(rows: readonly ComparisonRow[]): PairIdentity[] {
  const byIndex = new Map<number, PairIdentity>();
  rows.forEach((row) => {
    const index = pairIndexOf(row);
    if (byIndex.has(index)) return;
    const oldYear = yearOf(row.pair_old_year) ?? yearOf(row['Run Year OLD']);
    const newYear = yearOf(row.pair_new_year) ?? yearOf(row['Run Year NEW']);
    byIndex.set(index, {
      index,
      oldYear,
      newYear,
      oldLabel: oldYear === null ? `Run ${index + 1}` : `ILI ${oldYear}`,
      newLabel: newYear === null ? `Run ${index + 2}` : `ILI ${newYear}`,
    });
  });
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}

/**
 * Anchors mapping a pair's OLD run odometer onto the pair's NEW run odometer.
 * The destination is the matched NEW side's own reported distance (`snapM`),
 * not the engine's shifted `mappedM`, so a matched girth weld lands on the
 * exact same X as its partner in the newer lane instead of a fraction of a
 * metre off.  Anomalies only stand in as anchors when the pair produced no
 * matched welds at all — welds are the locked evidence of the alignment.
 */
function pairAnchors(observations: Observation[]): Array<{ from: number; to: number }> {
  const welds: Array<{ from: number; to: number }> = [];
  const others: Array<{ from: number; to: number }> = [];
  for (const observation of observations) {
    if (observation.side !== 'old' || !observation.rowMatched) continue;
    if (observation.rawM === null || observation.snapM === null) continue;
    const anchor = { from: observation.rawM, to: observation.snapM };
    if (observation.kind === 'weld') welds.push(anchor);
    else others.push(anchor);
  }
  return welds.length >= 2 ? welds : [...welds, ...others];
}

function statusOf(matchedBack: boolean | null, matchedForward: boolean | null): LaneFeatureStatus {
  if (matchedBack === null && matchedForward === null) return 'single';
  const isNew = matchedBack === false;
  const isLost = matchedForward === false;
  if (isNew && isLost) return 'transient';
  if (isNew) return 'new';
  if (isLost) return 'lost';
  return 'persistent';
}

/**
 * Fold pair-shaped comparison rows into one lane per inspection run.
 */
export function buildComparisonLanes(rows: readonly ComparisonRow[]): ComparisonLaneModel {
  const identities = pairIdentities(rows);
  if (identities.length === 0) return { lanes: [], pairCount: 0, unalignedRuns: [] };

  // Run r is the OLD side of pair r and the NEW side of pair r-1, so N pairs
  // describe N+1 runs.
  const pairOrder = new Map(identities.map((identity, order) => [identity.index, order]));
  const runCount = identities.length + 1;
  const runLabels = [
    ...identities.map((identity) => identity.oldLabel),
    identities[identities.length - 1].newLabel,
  ];
  const runYears = [
    ...identities.map((identity) => identity.oldYear),
    identities[identities.length - 1].newYear,
  ];

  const observationsByPair = new Map<number, Observation[]>();
  const byRun: Array<Map<string, Observation[]>> = Array.from({ length: runCount }, () => new Map());

  rows.forEach((row, rowIndex) => {
    if (row.__excluded === true) return;
    const order = pairOrder.get(pairIndexOf(row));
    if (order === undefined) return;
    const oldPresent = present(row['Identif. OLD']) || num(row['Log Dist OLD (m)']) !== null
      || num(row['Original Log Dist OLD (m)']) !== null;
    const newPresent = present(row['Identif. NEW']) || num(row['Log Dist NEW (m)']) !== null
      || num(row['Original Log Dist NEW (m)']) !== null;
    const rowMatched = oldPresent && newPresent;

    // NEW first so its raw distance is known before wiring it into the OLD
    // observation's snap point.  The snap point is what lets a matched pair
    // sit on the exact same vertical in the chart when the axis is
    // calibrated, rather than sitting a few cm apart because the engine's
    // shift left a residual gap.
    const newObservation = sideObservation(row, rowIndex, order, 'new', rowMatched);
    const oldObservation = sideObservation(row, rowIndex, order, 'old', rowMatched);
    if (rowMatched && oldObservation && newObservation && newObservation.rawM !== null) {
      oldObservation.snapM = newObservation.rawM;
    }

    const pairBucket = observationsByPair.get(order) ?? [];
    ([['old', order, oldObservation], ['new', order + 1, newObservation]] as const).forEach(([, runIndex, observation]) => {
      if (!observation) return;
      pairBucket.push(observation);
      const runBucket = byRun[runIndex];
      const existing = runBucket.get(observation.key);
      if (existing) existing.push(observation);
      else runBucket.set(observation.key, [observation]);
    });
    observationsByPair.set(order, pairBucket);
  });

  // Hop r carries run r's odometer onto run r+1's. Composing hops r+1 … N-1
  // walks an older run all the way onto the newest run's axis.
  const hops = identities.map((_identity, order) => buildProjector(
    pairAnchors(observationsByPair.get(order) ?? []),
  ));

  const unalignedRuns: string[] = [];
  const lanes: ComparisonLane[] = [];

  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const isMaster = runIndex === runCount - 1;
    const ownHop = hops[runIndex] ?? null;
    const laterHops = hops.slice(runIndex + 1);
    const composable = laterHops.every((hop) => hop !== null);
    const features: LaneFeature[] = [];

    byRun[runIndex].forEach((observations, key) => {
      // The run's own pair (as OLD side) carries the mapping toward the newer
      // run; the previous pair (as NEW side) only says whether it was matched.
      const forward = observations.find((observation) => observation.side === 'old') ?? null;
      const back = observations.find((observation) => observation.side === 'new') ?? null;
      const primary = forward ?? back;
      if (!primary) return;

      const rawM = primary.rawM ?? back?.rawM ?? forward?.rawM ?? null;
      // A matched OLD observation carries `snapM` = its partner's own raw
      // distance in the newer run. Starting the projection from there makes
      // the matched pair land on exactly the same X in the chart.  Unmatched
      // features fall through to the projector built from matched-GW anchors,
      // which interpolates them into the same axis.
      let alignedM: number | null = null;
      if (isMaster) {
        alignedM = rawM;
      } else if (forward?.snapM !== null && forward?.snapM !== undefined && composable) {
        alignedM = laterHops.reduce<number>((value, hop) => (hop ? hop(value) : value), forward.snapM);
      } else if (rawM !== null && ownHop && composable) {
        const mappedIntoNewer = ownHop(rawM);
        alignedM = laterHops.reduce<number>((value, hop) => (hop ? hop(value) : value), mappedIntoNewer);
      }

      const matchedBack = back ? back.rowMatched : (runIndex === 0 ? null : false);
      const matchedForward = forward ? forward.rowMatched : (isMaster ? null : false);

      features.push({
        key,
        rowIndex: primary.rowIndex,
        backRowIndex: back?.rowIndex ?? null,
        forwardRowIndex: forward?.rowIndex ?? null,
        id: primary.id,
        kind: primary.kind,
        rawM,
        alignedM,
        clockHours: primary.clockHours,
        clockDeg: primary.clockHours === null ? null : primary.clockHours * 30,
        clockLabel: formatClockLabel(primary.clockHours),
        depthPct: primary.depthPct,
        lengthMm: primary.lengthMm,
        widthMm: primary.widthMm,
        usGwM: primary.usGwM,
        jointNo: primary.jointNo,
        external: primary.external,
        featureType: primary.featureType,
        matchedBack,
        matchedForward,
        status: statusOf(matchedBack, matchedForward),
      });
    });

    features.sort((left, right) => (left.rawM ?? Infinity) - (right.rawM ?? Infinity));
    // An empty lane has nothing to align, which is not the same as a lane whose
    // features could not be placed on the master odometer.
    const alignedAvailable = isMaster
      || features.length === 0
      || features.some((feature) => feature.alignedM !== null);
    if (!alignedAvailable) unalignedRuns.push(runLabels[runIndex]);

    lanes.push({
      runId: `run-${runIndex}`,
      label: runLabels[runIndex],
      year: runYears[runIndex],
      order: runIndex,
      isMaster,
      features,
      gws: features.filter((feature) => feature.kind === 'weld' && feature.rawM !== null),
      alignedAvailable,
      alignedIsDerived: !isMaster && laterHops.length > 0,
    });
  }

  return { lanes, pairCount: identities.length, unalignedRuns };
}

export function featureAxisValue(feature: LaneFeature, axis: AxisMode): number | null {
  return axis === 'raw' ? feature.rawM : (feature.alignedM ?? null);
}

/** Girth-weld-to-girth-weld segments of one lane on the active axis. */
export function laneJoints(lane: ComparisonLane, axis: AxisMode): LaneJoint[] {
  const welds = lane.gws
    .map((gw) => ({ gw, position: featureAxisValue(gw, axis) }))
    .filter((entry): entry is { gw: LaneFeature; position: number } => entry.position !== null)
    .sort((left, right) => left.position - right.position);

  const joints: LaneJoint[] = [];
  for (let index = 0; index < welds.length - 1; index += 1) {
    const start = welds[index];
    const end = welds[index + 1];
    joints.push({
      index,
      startM: start.position,
      endM: end.position,
      spanM: end.position - start.position,
      // Reported in the run's own odometer so a stretched aligned axis never
      // changes the joint length an engineer reads off the lane.
      trueLengthM: (end.gw.rawM ?? end.position) - (start.gw.rawM ?? start.position),
      startGw: start.gw,
      endGw: end.gw,
    });
  }
  return joints;
}

export function lanesExtent(lanes: readonly ComparisonLane[], axis: AxisMode): { min: number; max: number } {
  const values: number[] = [];
  for (const lane of lanes) {
    for (const feature of lane.features) {
      const value = featureAxisValue(feature, axis);
      if (value !== null) values.push(value);
    }
  }
  return extentOf(values, { min: 0, max: 1 });
}

export type PlacedFeature = LaneFeature & { position: number };

/**
 * A lane resolved onto one axis. Everything here is derived from the lane and
 * the axis alone, so it survives panning, zooming and cursor movement — the
 * viewer builds it once per axis change instead of re-sorting a 150k-feature
 * run on every mouse move.
 */
export interface LanePlacement {
  lane: ComparisonLane;
  axis: AxisMode;
  /** Features carrying a position on this axis, ascending. */
  placed: PlacedFeature[];
  joints: LaneJoint[];
  /** Active axis back to the run's own odometer; null when they are the same. */
  inverse: ((position: number) => number) | null;
}

export function placeLane(lane: ComparisonLane, axis: AxisMode): LanePlacement {
  const placed: PlacedFeature[] = [];
  for (const feature of lane.features) {
    const position = featureAxisValue(feature, axis);
    if (position !== null) placed.push({ ...feature, position });
  }
  placed.sort((left, right) => left.position - right.position);

  return {
    lane,
    axis,
    placed,
    joints: laneJoints(lane, axis),
    inverse: axis === 'raw'
      ? null
      : buildProjector(
        lane.features
          .filter((feature) => feature.alignedM !== null && feature.rawM !== null)
          .map((feature) => ({ from: feature.alignedM as number, to: feature.rawM as number })),
      ),
  };
}

/** First index whose position is >= value. */
function lowerBound(placed: PlacedFeature[], value: number): number {
  let low = 0;
  let high = placed.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (placed[middle].position < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Read a lane at an arbitrary point on the active axis: which joint the point
 * falls in, how far it sits from the upstream weld, and — when the lane is
 * drawn aligned — what that position is in the run's own odometer.
 */
export interface LaneReadout {
  trueLdM: number | null;
  jointIndex: number | null;
  usGwM: number | null;
  usGwId: string | null;
  jointLengthM: number | null;
  interpolated: boolean;
}

export function laneReadoutAt(placement: LanePlacement, position: number): LaneReadout {
  const { axis, joints, inverse } = placement;
  const trueLdM = axis === 'raw' ? position : (inverse ? inverse(position) : null);

  let joint: LaneJoint | null = null;
  let low = 0;
  let high = joints.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = joints[middle];
    if (position < candidate.startM) high = middle - 1;
    else if (position > candidate.endM) low = middle + 1;
    else {
      joint = candidate;
      break;
    }
  }

  return {
    trueLdM,
    jointIndex: joint ? joint.index : null,
    usGwM: joint ? position - joint.startM : null,
    usGwId: joint ? joint.startGw.id : null,
    jointLengthM: joint ? joint.trueLengthM : null,
    interpolated: axis === 'aligned',
  };
}

/**
 * Features inside `[start, end]`, thinned to at most `limit` marks so a
 * 150k-feature run still paints. Thinning drops the shallowest features first:
 * on a corrosion review the deep ones are the point, and welds — the joint
 * boundaries — plus `pinned` (the row selected in the table) always survive.
 */
export function laneFeaturesInWindow(
  placement: LanePlacement,
  start: number,
  end: number,
  limit: number,
  pinned?: (feature: LaneFeature) => boolean,
): { features: PlacedFeature[]; total: number } {
  const { placed } = placement;
  const from = lowerBound(placed, start);
  const visible: PlacedFeature[] = [];
  for (let index = from; index < placed.length && placed[index].position <= end; index += 1) {
    visible.push(placed[index]);
  }
  if (visible.length <= limit) return { features: visible, total: visible.length };

  const keep = (feature: PlacedFeature) => feature.kind === 'weld' || Boolean(pinned?.(feature));
  const kept = visible.filter(keep);
  const rest = visible
    .filter((feature) => !keep(feature))
    .sort((left, right) => (right.depthPct ?? 0) - (left.depthPct ?? 0))
    .slice(0, Math.max(0, limit - kept.length));
  return {
    features: [...kept, ...rest].sort((left, right) => left.position - right.position),
    total: visible.length,
  };
}
