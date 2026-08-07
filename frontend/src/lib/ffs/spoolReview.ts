/**
 * The assessment regrouped by spool — one piece of pipe between two girth
 * welds — instead of by feature.
 *
 * A repair is not made to a feature; it is made to a spool. Cutting and
 * replacing, fitting a sleeve, or grinding out happens to a length of pipe that
 * usually carries several anomalies, and the decision is taken once for all of
 * them. Reviewing feature by feature makes that decision impossible to see: the
 * governing ERF, the shortest life, the mean corrosion rate and the number of
 * interacting pits all belong to the spool, not to any single row.
 *
 * Everything here is aggregation. No B31G number is recalculated: the governing
 * ERF is the worst member's own ERF and the spool life is the shortest member's
 * own remnant life, so a figure quoted for a spool can always be traced to the
 * feature that produced it.
 */

import type { FfsGirthWeld, FfsSpoolCensusRow } from './alignmentImport.ts';
import type {
  FfsConfig,
  FfsRepairStatus,
  FfsScreenedResult,
  FfsScreeningConfig,
  FfsSeverity,
} from './types.ts';
import { findInteractions, growthApplicationFor } from './screening.ts';
import { remnantSortValue } from './lifeProjection.ts';
import { maxOf } from '../../utils/numericRange.ts';

/** How the boundary of a spool was established. */
export type FfsSpoolGrouping =
  /** Between two welds of the run's own girth-weld ladder: the real spool. */
  | 'girth-weld'
  /** The run reported a joint number. */
  | 'joint-number'
  /** Derived from the reported distance to the upstream girth weld. */
  | 'upstream-weld'
  /** None of the above was reported, so the features are grouped by section. */
  | 'unassigned';

export interface FfsSpoolGrowth {
  /** Mean depth growth over the members whose rate the analysis actually used. */
  meanMmPerYear: number | null;
  maxMmPerYear: number | null;
  /** Members whose rate came from a real run-to-run observation. */
  measuredCount: number;
  /** Members running on an assumed or fallback rate. */
  assumedCount: number;
  /** Members with no usable rate at all. */
  unavailableCount: number;
}

export interface FfsSpoolRepairCounts {
  unrepaired: number;
  temporary: number;
  permanent: number;
}

export interface FfsSpool {
  /** Stable key for selection and for the disposition register. */
  id: string;
  label: string;
  grouping: FfsSpoolGrouping;
  jointNumber: string | null;
  section: string;
  /** Log distance of the upstream girth weld, when it can be established. */
  usGwLdM: number | null;
  dsGwLdM: number | null;
  /** Identifiers of the two welds that bound the spool, when known. */
  usGwId: string | null;
  dsGwId: string | null;
  /** True for a real interval of the ladder, with a weld at each end. */
  weldBounded: boolean;
  /** Girth-weld-to-girth-weld length as the ILI reported it. */
  lengthM: number | null;
  /** Extent actually covered by the features, used when no weld is known. */
  firstFeatureLdM: number;
  lastFeatureLdM: number;
  /** The features the FFS assessed on this spool. Empty is a real answer. */
  members: FfsScreenedResult[];
  /** Alias of `members.length`, kept for readers of the aggregate. */
  featureCount: number;
  /**
   * Every metal-loss record the ILI reported on this spool, released for
   * assessment or not. A joint carrying nine unreleased pits and one released
   * one is not a joint with one defect on it, so the register counts the run
   * and marks how much of it was assessed.
   */
  metalLossTotal: number;
  assessedCount: number;
  unassessedCount: number;
  clusterCount: number;
  internalCount: number;
  externalCount: number;
  maxDepthPct: number;
  meanDepthPct: number;
  longestFeatureMm: number;
  /**
   * How much metal loss the joint is actually carrying. Summed over the same
   * population as `metalLossTotal`, so the count and the lengths always describe
   * the same set: the summed axial length answers "how much of the joint" and
   * the summed footprint answers "how much of the shell".
   */
  totalMetalLossLengthMm: number;
  totalMetalLossAreaMm2: number;
  /** Summed axial length as a fraction of the joint, when its length is known. */
  metalLossCoveragePct: number | null;
  governingErf: FfsScreenedResult | null;
  governingLife: FfsScreenedResult | null;
  worstNominalErf: number;
  worstConservativeErf: number;
  unacceptableCount: number;
  severity: FfsSeverity;
  growth: FfsSpoolGrowth;
  /** Member pairs inside the B31G para. 1.12(a) interaction threshold. */
  interactionCount: number;
  repairCounts: FfsSpoolRepairCounts;
  /**
   * Why the spool scores the way it does, in the order an engineer would read
   * it. Written from the aggregates above so the card and the Excel report can
   * never disagree about the reasoning.
   */
  drivers: string[];
}

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

function severityRank(severity: FfsSeverity): number {
  return severity === 'fail' ? 2 : severity === 'review' ? 1 : 0;
}

function formatMetres(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} m`;
}

/**
 * The drivers are prose that ends up in a report sheet, so a single missing
 * column must not take the whole register down with a TypeError.
 */
function fixed(value: number | null | undefined, digits: number): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits);
}

/**
 * The key a feature is grouped under, and how strong that identity is.
 *
 * A reported joint number beats a derived weld position, which beats nothing at
 * all: a spool built from a section name is a reviewing convenience, not a
 * piece of pipe, and the grouping is labelled so the reader can tell.
 */
function spoolKeyOf(
  item: FfsScreenedResult,
  ladder: readonly FfsGirthWeld[],
): { key: string; grouping: FfsSpoolGrouping; weldIndex: number | null } {
  if (ladder.length >= 2) {
    // The interval the feature falls in: index i means "between weld i and
    // weld i+1". -1 is upstream of the first weld, ladder.length-1 downstream
    // of the last; both are real places on the line and get their own bucket
    // rather than being folded into the nearest joint.
    const index = upperWeldIndex(ladder, numericLd(item)) - 1;
    return { key: `gw:${index}`, grouping: 'girth-weld', weldIndex: index };
  }
  const joint = item.nominal.jointNumber?.trim();
  if (joint) return { key: `joint:${joint}`, grouping: 'joint-number', weldIndex: null };
  const usGw = item.nominal.usGwDistanceM;
  if (usGw !== null && usGw !== undefined && Number.isFinite(usGw)) {
    // 0.1 m is finer than any real weld-position uncertainty, so two features
    // in one joint round to the same weld while two joints never merge.
    const weldLd = numericLd(item) - usGw;
    return { key: `usgw:${weldLd.toFixed(1)}`, grouping: 'upstream-weld', weldIndex: null };
  }
  return {
    key: `section:${item.nominal.section || 'unassigned'}`,
    grouping: 'unassigned',
    weldIndex: null,
  };
}

/** First weld strictly past `distance`; ladder.length when there is none. */
function upperWeldIndex(ladder: readonly FfsGirthWeld[], distance: number): number {
  let low = 0;
  let high = ladder.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ladder[middle].ldM <= distance) low = middle + 1;
    else high = middle;
  }
  return low;
}

function firstFinite(values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}

function summariseGrowth(
  members: FfsScreenedResult[],
  screening: FfsScreeningConfig,
): FfsSpoolGrowth {
  const rates: number[] = [];
  let measuredCount = 0;
  let assumedCount = 0;
  let unavailableCount = 0;

  for (const member of members) {
    // The rate the forecast actually ran on, not the raw column: under the
    // uniform basis every feature runs on the configured rate regardless of
    // what the ILI pair reported, and quoting the reported one would describe
    // an assessment nobody performed.
    const application = growthApplicationFor(member.nominal, screening);
    if (application.observation === 'unavailable' && application.rateMmPerYear <= 0) {
      unavailableCount += 1;
      continue;
    }
    if (application.analysisBasis === 'reported' || application.analysisBasis === 'estimated') {
      measuredCount += 1;
    } else {
      assumedCount += 1;
    }
    rates.push(application.rateMmPerYear);
  }

  if (rates.length === 0) {
    return { meanMmPerYear: null, maxMmPerYear: null, measuredCount, assumedCount, unavailableCount };
  }
  const total = rates.reduce((sum, rate) => sum + rate, 0);
  return {
    meanMmPerYear: total / rates.length,
    maxMmPerYear: maxOf(rates),
    measuredCount,
    assumedCount,
    unavailableCount,
  };
}

function buildDrivers(spool: Omit<FfsSpool, 'drivers'>): string[] {
  const drivers: string[] = [];
  // An empty joint is a normal result on a long line, not a gap in the data.
  // Saying so plainly is more use than a page of dashes.
  if (spool.metalLossTotal === 0) {
    return ['The inspection reported no metal loss between these two girth welds.'];
  }
  if (spool.assessedCount === 0) {
    drivers.push(
      `${spool.metalLossTotal} metal-loss record${spool.metalLossTotal === 1 ? '' : 's'} were reported on this ` +
      'spool, but none was released to the assessment by the Corrosion Analysis review, so there is no ERF or ' +
      'remnant life for it here.',
    );
  }
  const erf = spool.governingErf;
  if (erf) {
    const n = erf.nominal;
    drivers.push(
      `Governing ERF ${fixed(n.ERF, 3)} comes from ${n.featureId ?? `LD ${fixed(numericLd(erf), 1)} m`}: ` +
      `${fixed(n.maxDepthPct, 1)} %WT deep over ${fixed(n.length, 0)} mm, ` +
      `B31G branch ${n.branch ?? 'not reported'}, safe pressure ${fixed(n.safePressure, 2)} MPa ` +
      `against ${fixed(n.p0, 2)} MPa required.`,
    );
  }
  if (spool.worstConservativeErf > spool.worstNominalErf) {
    drivers.push(
      `With the ILI tolerance applied the same spool reaches ERF ${fixed(spool.worstConservativeErf, 3)} — ` +
      'the margin between the two is sizing uncertainty, not corrosion.',
    );
  }
  const life = spool.governingLife;
  if (life !== null && life.nominal.remnantLife.years !== null) {
    const remnant = life.nominal.remnantLife;
    drivers.push(
      `Shortest remnant life ${fixed(remnant.years, 1)} y, limited by ${remnant.governingLimit ?? 'no established limit'}` +
      `${remnant.dueDateIso ? ` (${remnant.dueDateIso})` : ''}, from ` +
      `${life.nominal.featureId ?? `LD ${fixed(numericLd(life), 1)} m`}.`,
    );
    if (remnant.lengthHeldConstant) {
      drivers.push(
        'No axial growth rate was established, so the length was carried forward unchanged: ' +
        'the life above is not conservative in the length direction.',
      );
    }
  } else if (spool.assessedCount > 0) {
    drivers.push('No finite remnant life was established for this spool within the analysis horizon.');
  }
  if (spool.growth.meanMmPerYear !== null) {
    drivers.push(
      `Mean depth growth across the spool ${fixed(spool.growth.meanMmPerYear, 3)} mm/y ` +
      `(worst ${fixed(spool.growth.maxMmPerYear, 3)} mm/y) over ` +
      `${spool.growth.measuredCount} observed and ${spool.growth.assumedCount} assumed rates` +
      `${spool.growth.unavailableCount > 0 ? `, ${spool.growth.unavailableCount} with no rate at all` : ''}.`,
    );
  } else if (spool.assessedCount > 0) {
    drivers.push('No usable corrosion rate on any feature in this spool, so nothing here projects forward.');
  }
  drivers.push(
    `${spool.metalLossTotal} metal-loss record${spool.metalLossTotal === 1 ? '' : 's'} on this spool` +
    `${spool.unassessedCount > 0 ? ` (${spool.assessedCount} assessed, ${spool.unassessedCount} not released)` : ''}, ` +
    `${fixed(spool.totalMetalLossLengthMm, 0)} mm of axial length in total` +
    `${spool.metalLossCoveragePct !== null ? ` (${fixed(spool.metalLossCoveragePct, 1)} % of the joint)` : ''}, ` +
    `footprint ${fixed(spool.totalMetalLossAreaMm2 / 1e6, 3)} m².`,
  );
  if (spool.clusterCount > 0) {
    drivers.push(
      `${spool.clusterCount} of the ${spool.metalLossTotal} records are vendor-merged clusters: their extent is a ` +
      'bounding box over several pits and they carry no run-pair growth rate.',
    );
  }
  if (spool.interactionCount > 0) {
    drivers.push(
      `${spool.interactionCount} member pair${spool.interactionCount === 1 ? '' : 's'} fall inside the ` +
      'interaction spacing, so the spool may behave as a longer flaw than any single feature suggests.',
    );
  }
  if (spool.grouping === 'upstream-weld') {
    drivers.push('Spool boundary derived from the reported distance to the upstream girth weld; the run carried no weld ladder.');
  } else if (spool.grouping === 'unassigned') {
    drivers.push('The run reported no girth weld, joint number or upstream-weld distance for these features, so this group is a section, not a spool.');
  }
  return drivers;
}

export interface BuildSpoolsOptions {
  screening: FfsScreeningConfig;
  /**
   * The NEW run's girth welds. When present this is what a spool is: the pipe
   * between two of them, and *every* pair produces a spool — the register is an
   * inventory of the line, so a joint the inspection found nothing on is a row
   * reading zero, not a row that is missing. Everything else is a fallback for
   * a run that did not report a ladder.
   */
  girthWelds?: readonly FfsGirthWeld[];
  /**
   * Every metal-loss record the run reported, released for assessment or not.
   * Without it the register can only count the assessed subset, which on a line
   * where the review released a handful of features makes most joints look
   * clean when they are not.
   */
  census?: readonly FfsSpoolCensusRow[];
  /** Only used to keep interaction screening consistent with the other tabs. */
  config?: FfsConfig;
}

interface SpoolBucket {
  grouping: FfsSpoolGrouping;
  weldIndex: number | null;
  members: FfsScreenedResult[];
  census: FfsSpoolCensusRow[];
}

/**
 * Group the run into spools.
 *
 * With a weld ladder this enumerates the line: one spool per pair of welds,
 * plus the stretches before the first weld and after the last one when anything
 * sits there. Without one it falls back to grouping only what it has.
 */
export function buildFfsSpools(
  items: FfsScreenedResult[],
  { screening, girthWelds = [], census = [] }: BuildSpoolsOptions,
): FfsSpool[] {
  const ladder = [...girthWelds].sort((left, right) => left.ldM - right.ldM);
  const hasLadder = ladder.length >= 2;
  const buckets = new Map<string, SpoolBucket>();

  const bucketFor = (key: string, grouping: FfsSpoolGrouping, weldIndex: number | null) => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { grouping, weldIndex, members: [], census: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  // Seed every interval of the ladder first, so a joint with nothing on it is
  // still a row. This is the whole point of a per-weld register: an engineer
  // reading it is walking the line, and a missing joint reads as missing data.
  if (hasLadder) {
    for (let index = 0; index < ladder.length - 1; index += 1) {
      bucketFor(`gw:${index}`, 'girth-weld', index);
    }
  }

  for (const item of items) {
    const { key, grouping, weldIndex } = spoolKeyOf(item, ladder);
    bucketFor(key, grouping, weldIndex).members.push(item);
  }

  // The census is only bucketable against the ladder: the fallback keys are
  // derived from per-feature columns a census row does not carry.
  if (hasLadder) {
    for (const row of census) {
      const index = upperWeldIndex(ladder, row.ldM) - 1;
      bucketFor(`gw:${index}`, 'girth-weld', index).census.push(row);
    }
  }

  const spools: FfsSpool[] = [];
  for (const [id, { grouping, weldIndex, members, census: spoolCensus }] of buckets) {
    const ordered = [...members].sort((a, b) => numericLd(a) - numericLd(b));
    const distances = ordered.map(numericLd);
    const jointNumber = firstNonEmpty(ordered.map((item) => item.nominal.jointNumber));
    const upstream = weldIndex !== null && weldIndex >= 0 ? ladder[weldIndex] ?? null : null;
    const downstream = weldIndex !== null && weldIndex + 1 < ladder.length
      ? ladder[weldIndex + 1] ?? null
      : null;
    // The ladder wins where it exists: it is a measured weld position, not a
    // column the vendor may have filled in from its own joint tally.
    const usGwLdM = upstream?.ldM ?? firstFinite(ordered.map((item) => {
      const usGw = item.nominal.usGwDistanceM;
      return usGw === null || usGw === undefined ? null : numericLd(item) - usGw;
    }));
    const reportedJointLengthM = firstFinite(ordered.map((item) => item.nominal.jointLengthM));
    const dsGwLdM = downstream?.ldM
      ?? (usGwLdM !== null && reportedJointLengthM !== null ? usGwLdM + reportedJointLengthM : null);
    const lengthM = usGwLdM !== null && dsGwLdM !== null
      ? dsGwLdM - usGwLdM
      : reportedJointLengthM;

    const governingErf = ordered.reduce<FfsScreenedResult | null>((worst, item) => (
      !worst || item.nominal.ERF > worst.nominal.ERF ? item : worst
    ), null);
    // Sorted by the shared remnant sort value so "shortest life" means the same
    // thing here as it does in the results table and the report case.
    const governingLife = ordered.reduce<FfsScreenedResult | null>((shortest, item) => {
      if (item.nominal.remnantLife.years === null) return shortest;
      if (!shortest) return item;
      return remnantSortValue(item.nominal.remnantLife) < remnantSortValue(shortest.nominal.remnantLife)
        ? item
        : shortest;
    }, null);

    const worstConservative = ordered.reduce(
      (worst, item) => Math.max(worst, Number.isFinite(item.conservative.ERF) ? item.conservative.ERF : worst),
      0,
    );
    const severity = ordered.reduce<FfsSeverity>((worst, item) => (
      severityRank(item.conservative.severity) > severityRank(worst) ? item.conservative.severity : worst
    ), 'pass');

    const repairCounts: FfsSpoolRepairCounts = { unrepaired: 0, temporary: 0, permanent: 0 };
    let internalCount = 0;
    let externalCount = 0;
    for (const item of ordered) {
      if (/int/i.test(item.nominal.surface ?? '')) internalCount += 1;
      else if (/ext/i.test(item.nominal.surface ?? '')) externalCount += 1;
      if (item.nominal.repairStatus === 'temporary-repair') repairCounts.temporary += 1;
      else if (item.nominal.repairStatus === 'permanent-repair-verified') repairCounts.permanent += 1;
      else repairCounts.unrepaired += 1;
    }

    // The census is the run; the members are what the review released from it.
    // Counts and lengths are taken from the same population so they can never
    // describe different sets, and the census wins whenever it is available.
    const useCensus = spoolCensus.length > 0 || (hasLadder && census.length > 0);
    const depths = useCensus
      ? spoolCensus.map((row) => row.depthPct).filter((value): value is number => value !== null)
      : ordered.map((item) => item.nominal.maxDepthPct);
    const lengths = useCensus
      ? spoolCensus.map((row) => row.lengthMm ?? 0)
      : ordered.map((item) => item.nominal.length);
    const totalMetalLossLengthMm = lengths.reduce((sum, value) => sum + value, 0);
    const totalMetalLossAreaMm2 = useCensus
      ? spoolCensus.reduce((sum, row) => sum + (row.lengthMm ?? 0) * (row.widthMm ?? 0), 0)
      : ordered.reduce((sum, item) => sum + item.nominal.length * item.nominal.width, 0);
    const clusterCount = useCensus
      ? spoolCensus.filter((row) => row.isCluster).length
      : ordered.filter((item) => item.nominal.isClusteredMetalLoss).length;
    const metalLossTotal = useCensus ? spoolCensus.length : ordered.length;

    // An empty joint carries no feature to take a section name from, so it
    // inherits the boundary it sits on rather than inventing one.
    const section = ordered[0]?.nominal.section ?? '';
    const positions = distances.length > 0
      ? distances
      : spoolCensus.length > 0
        ? spoolCensus.map((row) => row.ldM)
        : [usGwLdM ?? 0, dsGwLdM ?? usGwLdM ?? 0];

    const partial: Omit<FfsSpool, 'drivers'> = {
      id,
      label: spoolLabel({
        jointNumber,
        usGwId: upstream?.id ?? null,
        dsGwId: downstream?.id ?? null,
        usGwLdM,
        dsGwLdM,
        distances: positions,
        grouping,
        section,
      }),
      grouping,
      jointNumber,
      section,
      usGwLdM,
      dsGwLdM,
      usGwId: upstream?.id ?? null,
      dsGwId: downstream?.id ?? null,
      weldBounded: upstream !== null && downstream !== null,
      lengthM,
      firstFeatureLdM: positions[0],
      lastFeatureLdM: positions[positions.length - 1],
      members: ordered,
      featureCount: ordered.length,
      metalLossTotal,
      assessedCount: ordered.length,
      unassessedCount: Math.max(0, metalLossTotal - ordered.length),
      clusterCount,
      internalCount,
      externalCount,
      maxDepthPct: maxOf(depths),
      meanDepthPct: depths.length > 0
        ? depths.reduce((sum, value) => sum + value, 0) / depths.length
        : 0,
      longestFeatureMm: maxOf(lengths),
      totalMetalLossLengthMm,
      totalMetalLossAreaMm2,
      metalLossCoveragePct: lengthM !== null && lengthM > 0
        ? (totalMetalLossLengthMm / (lengthM * 1000)) * 100
        : null,
      governingErf,
      governingLife,
      worstNominalErf: governingErf ? governingErf.nominal.ERF : 0,
      worstConservativeErf: worstConservative,
      unacceptableCount: ordered.filter((item) => item.nominal.acceptance === 'Un-Acceptable').length,
      severity,
      growth: summariseGrowth(ordered, screening),
      // Interaction is screened inside the spool: two pits on either side of a
      // girth weld are on different pieces of pipe and are not one flaw.
      interactionCount: ordered.length > 1 ? findInteractions(ordered, screening).length : 0,
      repairCounts,
    };
    spools.push({ ...partial, drivers: buildDrivers(partial) });
  }

  // Along the line, not worst first. The register is now an inventory of every
  // joint, and an inventory that jumps about is unreadable; the table header
  // re-sorts it by severity or ERF in one click when that is the question.
  return spools
    .filter((spool) => (
      // Leading and trailing stretches only exist when something is on them.
      spool.grouping !== 'girth-weld'
      || spool.weldBounded
      || spool.metalLossTotal > 0
      || spool.assessedCount > 0
    ))
    .sort((left, right) => (
      (left.usGwLdM ?? left.firstFeatureLdM) - (right.usGwLdM ?? right.firstFeatureLdM)
      || left.firstFeatureLdM - right.firstFeatureLdM
    ));
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function spoolLabel({
  jointNumber,
  usGwId,
  dsGwId,
  usGwLdM,
  dsGwLdM,
  distances,
  grouping,
  section,
}: {
  jointNumber: string | null;
  usGwId: string | null;
  dsGwId: string | null;
  usGwLdM: number | null;
  dsGwLdM: number | null;
  distances: number[];
  grouping: FfsSpoolGrouping;
  section: string;
}): string {
  if (grouping === 'girth-weld') {
    // Named by the two welds that bound it, because that is how the spool is
    // identified on site and in the dig sheet.
    if (usGwId && dsGwId) {
      return `GW ${usGwId} → ${dsGwId}${jointNumber ? ` · Joint ${jointNumber}` : ''}`;
    }
    if (dsGwId) return `Upstream of GW ${dsGwId}`;
    if (usGwId) return `Downstream of GW ${usGwId}`;
  }
  if (jointNumber) return `Joint ${jointNumber}`;
  if (grouping === 'upstream-weld' && usGwLdM !== null) {
    return dsGwLdM !== null
      ? `GW ${formatMetres(usGwLdM)} – ${formatMetres(dsGwLdM)}`
      : `Downstream of GW at ${formatMetres(usGwLdM)}`;
  }
  return `${section || 'Unassigned'} · ${formatMetres(distances[0])} – ${formatMetres(distances[distances.length - 1])}`;
}

/** How permanent a repair method is, in the sense the FFS report uses. */
export type FfsRepairClass = 'permanent' | 'temporary' | 'monitor';

export interface FfsRepairOption {
  id: string;
  label: string;
  repairClass: FfsRepairClass;
  /** What the method actually does, and when it is the right answer. */
  note: string;
}

/**
 * The dispositions an integrity engineer picks between for a corroded spool.
 * Deliberately a fixed list: a free-text method cannot be counted, filtered or
 * reported on, and the register is meant to be a controlled document.
 */
export const FFS_REPAIR_OPTIONS: readonly FfsRepairOption[] = Object.freeze([
  {
    id: 'cut-and-replace',
    label: 'Cut out and replace spool',
    repairClass: 'permanent',
    note: 'Removes the defect entirely. The answer when the metal loss is through-wall-critical, dense across the joint, or beyond the depth B31G is written for.',
  },
  {
    id: 'type-b-sleeve',
    label: 'Type B full-encirclement sleeve (pressure containing)',
    repairClass: 'permanent',
    note: 'Welded end fillets carry pressure, so it restores capacity and contains a leak. Suitable for a defect that may become through-wall.',
  },
  {
    id: 'type-a-sleeve',
    label: 'Type A reinforcing sleeve (non-pressure containing)',
    repairClass: 'temporary',
    note: 'Reinforces without containing pressure. Suitable for non-leaking external corrosion only, and not credited as a permanent repair.',
  },
  {
    id: 'composite-wrap',
    label: 'Composite repair wrap',
    repairClass: 'permanent',
    note: 'Engineered wrap over external, non-leaking metal loss. Permanent only where the design life of the wrap covers the remaining service life.',
  },
  {
    id: 'weld-deposition',
    label: 'Weld metal deposition',
    repairClass: 'permanent',
    note: 'Restores wall on external metal loss with sufficient remaining thickness for a hot-work procedure.',
  },
  {
    id: 'grind-and-blend',
    label: 'Grind out and blend',
    repairClass: 'permanent',
    note: 'For shallow defects only, and only where the ground profile is re-assessed and still acceptable to B31G.',
  },
  {
    id: 'mechanical-clamp',
    label: 'Bolt-on mechanical clamp',
    repairClass: 'temporary',
    note: 'Rapid containment without hot work. A holding measure until a permanent repair is scheduled.',
  },
  {
    id: 'leak-clamp',
    label: 'Leak clamp / enclosure',
    repairClass: 'temporary',
    note: 'Contains an active leak. Never a final disposition.',
  },
  {
    id: 'pressure-derate',
    label: 'Pressure de-rate to the calculated safe pressure',
    repairClass: 'temporary',
    note: 'Brings ERF back under 1 by lowering the required pressure instead of restoring metal. Needs an operating and commercial decision, not just an engineering one.',
  },
  {
    id: 'recoat',
    label: 'Excavate, clean and recoat',
    repairClass: 'temporary',
    note: 'Stops further external corrosion but restores no capacity. Appropriate where the present depth is acceptable and the concern is the rate.',
  },
  {
    id: 'monitor-reinspect',
    label: 'Monitor and re-inspect',
    repairClass: 'monitor',
    note: 'No intervention now, with a defined re-inspection interval derived from the remnant life.',
  },
  {
    id: 'no-action',
    label: 'No action required',
    repairClass: 'monitor',
    note: 'Acceptable at the assessed condition and rate for the remainder of the design life.',
  },
]);

export function repairOptionById(id: string | null): FfsRepairOption | null {
  if (!id) return null;
  return FFS_REPAIR_OPTIONS.find((option) => option.id === id) ?? null;
}

export interface FfsSpoolSuggestion {
  optionId: string;
  reason: string;
}

/**
 * A starting point for the engineer, never a decision.
 *
 * The thresholds are the ones already used elsewhere in this workspace — ERF 1,
 * the 80 %WT limit B31G is written for, and the configured review band — so the
 * suggestion cannot disagree with the acceptance column beside it.
 */
export function suggestSpoolDisposition(
  spool: FfsSpool,
  screening: FfsScreeningConfig,
  reviewYears: number,
): FfsSpoolSuggestion {
  const life = spool.governingLife?.nominal.remnantLife.years ?? null;
  if (spool.maxDepthPct >= screening.depthRejectionPct) {
    return {
      optionId: 'cut-and-replace',
      reason: `Deepest feature ${spool.maxDepthPct.toFixed(1)} %WT is at or past the ${screening.depthRejectionPct} %WT rejection limit, where the B31G tables no longer apply.`,
    };
  }
  if (spool.worstNominalErf >= 1) {
    return {
      optionId: 'type-b-sleeve',
      reason: `Nominal ERF ${spool.worstNominalErf.toFixed(3)} means the calculated safe pressure is already below the required pressure — capacity has to be restored or the pressure lowered.`,
    };
  }
  if (spool.worstConservativeErf >= 1) {
    return {
      optionId: 'composite-wrap',
      reason: `The spool passes nominally but reaches ERF ${spool.worstConservativeErf.toFixed(3)} once the ILI sizing tolerance is applied.`,
    };
  }
  if (life !== null && life <= reviewYears) {
    return {
      optionId: 'monitor-reinspect',
      reason: `Remnant life ${life.toFixed(1)} y is inside the ${reviewYears} y review threshold: schedule the re-inspection before planning an intervention.`,
    };
  }
  if (spool.worstConservativeErf >= screening.reviewBandErf) {
    return {
      optionId: 'monitor-reinspect',
      reason: `Conservative ERF ${spool.worstConservativeErf.toFixed(3)} sits in the review band above ${screening.reviewBandErf.toFixed(2)}.`,
    };
  }
  return {
    optionId: 'no-action',
    reason: 'Acceptable nominally and with tolerance applied, and no member reaches a limit inside the review threshold.',
  };
}

/**
 * A spool card records one of two things, and they are not the same statement.
 *
 * `recommendation` is what the engineer thinks should be done. It has no date,
 * because a recommendation is not scheduled work, and it never changes the
 * assessed population.
 *
 * `repaired` is a claim that work has already been carried out, which does
 * change the population — so it is the only mode that asks for a completion
 * date and an evidence reference, and the only one that writes a repair status.
 */
export type FfsSpoolDispositionMode = 'recommendation' | 'repaired';

export interface FfsSpoolDisposition {
  mode: FfsSpoolDispositionMode;
  optionId: string | null;
  owner: string | null;
  justification: string | null;
  /** `repaired` only: whether the completed work is temporary or permanent. */
  repairKind: Extract<FfsRepairStatus, 'temporary-repair' | 'permanent-repair-verified'>;
  /** `repaired` only. */
  completedDateIso: string | null;
  evidenceReference: string | null;
  /**
   * Members the record applies to, by feature index. A spool decision is
   * usually taken for the whole joint, but a sleeve over one pit while the rest
   * of the joint is left to the next inspection is a real answer too.
   */
  memberIndexes: number[];
}

export function emptySpoolDisposition(spool: FfsSpool): FfsSpoolDisposition {
  return {
    mode: 'recommendation',
    optionId: null,
    owner: null,
    justification: null,
    repairKind: 'permanent-repair-verified',
    completedDateIso: null,
    evidenceReference: null,
    memberIndexes: spool.members.map((member) => member.index),
  };
}

export interface FfsSpoolProgramme {
  spools: FfsSpool[];
  dispositions: Map<string, FfsSpoolDisposition>;
  decided: number;
  undecided: number;
  recommendedCount: number;
  repairedCount: number;
  /** Features covered by a recorded spool record. */
  coveredFeatures: number;
}

export function buildSpoolProgramme(
  spools: FfsSpool[],
  dispositions: Record<string, FfsSpoolDisposition>,
): FfsSpoolProgramme {
  const map = new Map<string, FfsSpoolDisposition>();
  let recommendedCount = 0;
  let repairedCount = 0;
  let coveredFeatures = 0;
  for (const spool of spools) {
    const disposition = dispositions[spool.id];
    if (!disposition) continue;
    map.set(spool.id, disposition);
    if (disposition.mode === 'repaired') repairedCount += 1;
    else recommendedCount += 1;
    coveredFeatures += disposition.memberIndexes.length;
  }
  return {
    spools,
    dispositions: map,
    decided: map.size,
    undecided: spools.length - map.size,
    recommendedCount,
    repairedCount,
    coveredFeatures,
  };
}
