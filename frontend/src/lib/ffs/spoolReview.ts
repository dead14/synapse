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

import type {
  FfsConfig,
  FfsScreenedResult,
  FfsScreeningConfig,
  FfsSeverity,
} from './types.ts';
import { findInteractions, growthApplicationFor } from './screening.ts';
import { remnantSortValue } from './lifeProjection.ts';

/** How the boundary of a spool was established. */
export type FfsSpoolGrouping =
  /** The run reported a joint number: the strongest identity available. */
  | 'joint-number'
  /** Derived from the reported distance to the upstream girth weld. */
  | 'upstream-weld'
  /** Neither was reported, so the features are grouped by section only. */
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
  /** Girth-weld-to-girth-weld length as the ILI reported it. */
  lengthM: number | null;
  /** Extent actually covered by the features, used when no weld is known. */
  firstFeatureLdM: number;
  lastFeatureLdM: number;
  members: FfsScreenedResult[];
  featureCount: number;
  clusterCount: number;
  internalCount: number;
  externalCount: number;
  maxDepthPct: number;
  meanDepthPct: number;
  longestFeatureMm: number;
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
function spoolKeyOf(item: FfsScreenedResult): { key: string; grouping: FfsSpoolGrouping } {
  const joint = item.nominal.jointNumber?.trim();
  if (joint) return { key: `joint:${joint}`, grouping: 'joint-number' };
  const usGw = item.nominal.usGwDistanceM;
  if (usGw !== null && usGw !== undefined && Number.isFinite(usGw)) {
    // 0.1 m is finer than any real weld-position uncertainty, so two features
    // in one joint round to the same weld while two joints never merge.
    const weldLd = numericLd(item) - usGw;
    return { key: `gw:${weldLd.toFixed(1)}`, grouping: 'upstream-weld' };
  }
  return { key: `section:${item.nominal.section || 'unassigned'}`, grouping: 'unassigned' };
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
    maxMmPerYear: Math.max(...rates),
    measuredCount,
    assumedCount,
    unavailableCount,
  };
}

function buildDrivers(spool: Omit<FfsSpool, 'drivers'>): string[] {
  const drivers: string[] = [];
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
  } else {
    drivers.push('No finite remnant life was established for this spool within the analysis horizon.');
  }
  if (spool.growth.meanMmPerYear !== null) {
    drivers.push(
      `Mean depth growth across the spool ${fixed(spool.growth.meanMmPerYear, 3)} mm/y ` +
      `(worst ${fixed(spool.growth.maxMmPerYear, 3)} mm/y) over ` +
      `${spool.growth.measuredCount} observed and ${spool.growth.assumedCount} assumed rates` +
      `${spool.growth.unavailableCount > 0 ? `, ${spool.growth.unavailableCount} with no rate at all` : ''}.`,
    );
  } else {
    drivers.push('No usable corrosion rate on any feature in this spool, so nothing here projects forward.');
  }
  if (spool.clusterCount > 0) {
    drivers.push(
      `${spool.clusterCount} of the ${spool.featureCount} records are vendor-merged clusters: their extent is a ` +
      'bounding box over several pits and they carry no run-pair growth rate.',
    );
  }
  if (spool.interactionCount > 0) {
    drivers.push(
      `${spool.interactionCount} member pair${spool.interactionCount === 1 ? '' : 's'} fall inside the ` +
      'interaction spacing, so the spool may behave as a longer flaw than any single feature suggests.',
    );
  }
  if (spool.grouping !== 'joint-number') {
    drivers.push(
      spool.grouping === 'upstream-weld'
        ? 'Spool boundary derived from the reported distance to the upstream girth weld; the run gave no joint number.'
        : 'The run reported neither a joint number nor a distance to the upstream weld, so this group is a section, not a spool.',
    );
  }
  return drivers;
}

export interface BuildSpoolsOptions {
  screening: FfsScreeningConfig;
  /** Only used to keep interaction screening consistent with the other tabs. */
  config?: FfsConfig;
}

/**
 * Group the screened population into spools, worst first.
 *
 * Ordering is by severity and then by governing ERF, because the register
 * exists to decide what to do next — not to walk the line end to end. The
 * caller can re-sort by distance when that is what is wanted.
 */
export function buildFfsSpools(
  items: FfsScreenedResult[],
  { screening }: BuildSpoolsOptions,
): FfsSpool[] {
  const buckets = new Map<string, { grouping: FfsSpoolGrouping; members: FfsScreenedResult[] }>();
  for (const item of items) {
    const { key, grouping } = spoolKeyOf(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.members.push(item);
    else buckets.set(key, { grouping, members: [item] });
  }

  const spools: FfsSpool[] = [];
  for (const [id, { grouping, members }] of buckets) {
    const ordered = [...members].sort((a, b) => numericLd(a) - numericLd(b));
    const distances = ordered.map(numericLd);
    const jointNumber = firstNonEmpty(ordered.map((item) => item.nominal.jointNumber));
    const lengthM = firstFinite(ordered.map((item) => item.nominal.jointLengthM));
    const usGwLdM = firstFinite(ordered.map((item) => {
      const usGw = item.nominal.usGwDistanceM;
      return usGw === null || usGw === undefined ? null : numericLd(item) - usGw;
    }));
    const dsGwLdM = usGwLdM !== null && lengthM !== null ? usGwLdM + lengthM : null;

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

    const depths = ordered.map((item) => item.nominal.maxDepthPct);
    const repairCounts: FfsSpoolRepairCounts = { unrepaired: 0, temporary: 0, permanent: 0 };
    let clusterCount = 0;
    let internalCount = 0;
    let externalCount = 0;
    for (const item of ordered) {
      if (item.nominal.isClusteredMetalLoss) clusterCount += 1;
      if (/int/i.test(item.nominal.surface ?? '')) internalCount += 1;
      else if (/ext/i.test(item.nominal.surface ?? '')) externalCount += 1;
      if (item.nominal.repairStatus === 'temporary-repair') repairCounts.temporary += 1;
      else if (item.nominal.repairStatus === 'permanent-repair-verified') repairCounts.permanent += 1;
      else repairCounts.unrepaired += 1;
    }

    const partial: Omit<FfsSpool, 'drivers'> = {
      id,
      label: spoolLabel(jointNumber, usGwLdM, dsGwLdM, distances, grouping, ordered[0].nominal.section),
      grouping,
      jointNumber,
      section: ordered[0].nominal.section,
      usGwLdM,
      dsGwLdM,
      lengthM,
      firstFeatureLdM: distances[0],
      lastFeatureLdM: distances[distances.length - 1],
      members: ordered,
      featureCount: ordered.length,
      clusterCount,
      internalCount,
      externalCount,
      maxDepthPct: Math.max(...depths),
      meanDepthPct: depths.reduce((sum, value) => sum + value, 0) / depths.length,
      longestFeatureMm: Math.max(...ordered.map((item) => item.nominal.length)),
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

  return spools.sort((left, right) => (
    severityRank(right.severity) - severityRank(left.severity)
    || right.worstConservativeErf - left.worstConservativeErf
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

function spoolLabel(
  jointNumber: string | null,
  usGwLdM: number | null,
  dsGwLdM: number | null,
  distances: number[],
  grouping: FfsSpoolGrouping,
  section: string,
): string {
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

export type FfsSpoolDecision = 'repair' | 'monitor' | 'defer' | 'no-action';

export interface FfsSpoolDisposition {
  decision: FfsSpoolDecision;
  optionId: string | null;
  targetDateIso: string | null;
  owner: string | null;
  justification: string | null;
  /**
   * Members the decision applies to, by feature index. A spool decision is
   * usually taken for the whole joint, but a sleeve over one pit while the rest
   * of the joint is left to the next inspection is a real answer too.
   */
  memberIndexes: number[];
}

export function emptySpoolDisposition(spool: FfsSpool): FfsSpoolDisposition {
  return {
    decision: 'monitor',
    optionId: null,
    targetDateIso: null,
    owner: null,
    justification: null,
    memberIndexes: spool.members.map((member) => member.index),
  };
}

export interface FfsSpoolProgramme {
  spools: FfsSpool[];
  dispositions: Map<string, FfsSpoolDisposition>;
  decided: number;
  undecided: number;
  repairCount: number;
  monitorCount: number;
  /** Features covered by a recorded spool decision. */
  coveredFeatures: number;
}

export function buildSpoolProgramme(
  spools: FfsSpool[],
  dispositions: Record<string, FfsSpoolDisposition>,
): FfsSpoolProgramme {
  const map = new Map<string, FfsSpoolDisposition>();
  let repairCount = 0;
  let monitorCount = 0;
  let coveredFeatures = 0;
  for (const spool of spools) {
    const disposition = dispositions[spool.id];
    if (!disposition) continue;
    map.set(spool.id, disposition);
    if (disposition.decision === 'repair') repairCount += 1;
    else monitorCount += 1;
    coveredFeatures += disposition.memberIndexes.length;
  }
  return {
    spools,
    dispositions: map,
    decided: map.size,
    undecided: spools.length - map.size,
    repairCount,
    monitorCount,
    coveredFeatures,
  };
}
