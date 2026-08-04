/**
 * The figures a fitness-for-service report leads with.
 *
 * Everything here is already computed somewhere in the workspace — it is spread
 * across the results table, the charts, the integrity KPIs, and the readiness
 * findings. That is the problem: the person signing the report has to assemble
 * "is it fit for service, for how long, what governs, and what do I do about
 * it" by reading five panels. This module assembles it once, from the same
 * screened results everything else reads, so the summary can never disagree
 * with the tables behind it.
 *
 * Nothing is rounded into a claim it cannot support: a figure that was not
 * established comes back null and is rendered as "not established", never as a
 * zero or a dash that reads like a measurement.
 */

import { analysisHorizonYears } from './lifeProjection.ts';
import { designLifeUsage, EMPTY_SERVICE_LIFE, type FfsDesignLifeUsage } from './remnantLife.ts';
import { buildFfsReportCase, type FfsPipelineRemnantLife, type FfsReportContext } from './reportCase.ts';
import { buildSectionGrowthSummary, type FfsSectionGrowthRow } from './sectionSummary.ts';
import { bucketIndexFor, isInternal, type DepthBucket } from './statistics.ts';
import { MEGAPASCALS_PER_BAR } from './units.ts';
import type {
  FfsConfig,
  FfsScreenedResult,
  FfsScreeningConfig,
} from './types.ts';

export interface FfsFeatureHighlight {
  item: FfsScreenedResult;
  /** The value that made this feature the highlight, already formatted. */
  value: string;
  /** Where it is, phrased for a summary line. */
  location: string;
}

export interface FfsDepthBandCount {
  label: string;
  color: string;
  count: number;
  internal: number;
  external: number;
  share: number;
}

export type FfsServiceVerdict = 'fit-for-service' | 'not-fit-for-service' | 'no-population';

export interface FfsExecutiveSummary {
  verdict: FfsServiceVerdict;
  /** Features failing the acceptance criteria in the active population. */
  failingCount: number;
  activeCount: number;
  assessedCount: number;
  pressureBasisMpa: number;

  remnantLife: FfsPipelineRemnantLife;
  remnantLifeAfterRepairProgramme: FfsPipelineRemnantLife;
  repairProgrammeCount: number;
  designLife: FfsDesignLifeUsage | null;
  /** Latest date the next inspection can be left to. Null when none applies. */
  nextInspectionByIso: string | null;
  /** True when the projected limit is already inside the deferral margin. */
  nextInspectionInsideMargin: boolean;

  lowestSafePressure: FfsFeatureHighlight | null;
  worstErf: FfsFeatureHighlight | null;
  deepest: FfsFeatureHighlight | null;
  fastestDepthGrowth: FfsFeatureHighlight | null;
  fastestLengthGrowth: FfsFeatureHighlight | null;

  internalCount: number;
  externalCount: number;
  bottomQuadrantCount: number;
  clusteredCount: number;
  depthBands: FfsDepthBandCount[];
  sections: FfsSectionGrowthRow[];

  /** Counts behind the caveats that must travel with the figures above. */
  dataGaps: { label: string; count: number; detail: string }[];
}

function locationOf(item: FfsScreenedResult): string {
  const distance = Number(item.nominal.ld);
  const metres = Number.isFinite(distance) ? `LD ${distance.toLocaleString(undefined, { maximumFractionDigits: 3 })} m` : 'LD unknown';
  const section = String(item.nominal.section ?? '').trim();
  return section && section !== '-' ? `${metres} · ${section}` : metres;
}

/**
 * The line figure as a table cell.
 *
 * A line-level status has one case a feature-level status does not: a mixture
 * where some features hit no limit inside the horizon and others have no growth
 * basis at all. Collapsing that into either one would tell the reader the wrong
 * thing about why there is no number.
 */
export function formatPipelineRemnantLife(
  life: FfsPipelineRemnantLife,
  horizonYears: number,
): string {
  if (life.years !== null) return `${life.years.toFixed(2)} y`;
  switch (life.status) {
    case 'empty': return 'No active feature';
    case 'insufficient-growth-basis': return 'Not calculated';
    case 'not-reached-within-horizon': return `Not reached in ${horizonYears} y`;
    case 'mixed-unbounded': return 'Not established';
    default: return 'Not established';
  }
}

/** Safe pressure in the two units this report is read in. */
export function formatPressure(mpa: number): string {
  return `${mpa.toFixed(2)} MPa (${(mpa / MEGAPASCALS_PER_BAR).toFixed(0)} barg)`;
}

/**
 * Three years before the governing feature reaches its limit.
 *
 * This is the reschedule rule the reference report applies — an inspection can
 * be deferred only while at least three years separate it from the projected
 * failure date. It is an inspection-planning hint derived from the remnant
 * life, not a risk assessment, and it deliberately produces nothing when no
 * limit was established.
 */
export const NEXT_INSPECTION_MARGIN_YEARS = 3;

function nextInspectionBy(remnantLife: FfsPipelineRemnantLife, iliDate: Date): string | null {
  if (remnantLife.years === null) return null;
  // Inside the margin there is no date left to quote. Subtracting to zero would
  // print the inspection date itself, which reads like a schedule rather than
  // like "this cannot be deferred at all".
  if (remnantLife.years <= NEXT_INSPECTION_MARGIN_YEARS) return null;
  const years = remnantLife.years - NEXT_INSPECTION_MARGIN_YEARS;
  const date = new Date(iliDate);
  const whole = Math.floor(years);
  date.setFullYear(date.getFullYear() + whole);
  date.setDate(date.getDate() + Math.round((years - whole) * 365.25));
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The extreme of a finite numeric property, or null when nothing qualifies. */
function extreme(
  items: FfsScreenedResult[],
  value: (item: FfsScreenedResult) => number | null,
  direction: 'max' | 'min',
  format: (item: FfsScreenedResult, value: number) => string,
): FfsFeatureHighlight | null {
  let best: { item: FfsScreenedResult; value: number } | null = null;
  for (const item of items) {
    const candidate = value(item);
    if (candidate === null || !Number.isFinite(candidate)) continue;
    if (!best || (direction === 'max' ? candidate > best.value : candidate < best.value)) {
      best = { item, value: candidate };
    }
  }
  return best
    ? { item: best.item, value: format(best.item, best.value), location: locationOf(best.item) }
    : null;
}

export function buildExecutiveSummary(
  items: FfsScreenedResult[],
  config: FfsConfig,
  screening: FfsScreeningConfig,
  reportContext: FfsReportContext,
  buckets: DepthBucket[],
): FfsExecutiveSummary {
  const reportCase = buildFfsReportCase(items, reportContext);
  const active = reportCase.asManagedItems;
  const horizonYears = analysisHorizonYears(config);

  const failingCount = active.filter((item) => item.nominal.acceptance === 'Un-Acceptable').length;
  const verdict: FfsServiceVerdict = items.length === 0
    ? 'no-population'
    : failingCount === 0
      ? 'fit-for-service'
      : 'not-fit-for-service';

  const depthBands: FfsDepthBandCount[] = buckets.map((bucket) => {
    const members = items.filter(
      (item) => bucketIndexFor(item.nominal.maxDepthPct, buckets) === buckets.indexOf(bucket),
    );
    const internal = members.filter(isInternal).length;
    return {
      label: bucket.name,
      color: bucket.color,
      count: members.length,
      internal,
      external: members.length - internal,
      share: items.length ? members.length / items.length : 0,
    };
  });

  const dataGaps = [
    {
      label: 'Length growth not established',
      count: active.filter((item) => item.nominal.remnantLife.lengthHeldConstant).length,
      detail: 'The projection holds the axial length constant for these features.',
    },
    {
      label: 'No growth basis',
      count: active.filter((item) => item.nominal.remnantLife.status === 'insufficient-growth-basis').length,
      detail: 'Neither depth nor length has a positive rate, so no remnant life is calculated.',
    },
    {
      label: 'Limit beyond the horizon',
      count: active.filter((item) => item.nominal.remnantLife.status === 'not-reached-within-horizon').length,
      detail: `No limit is reached inside the ${horizonYears}-year analysis horizon.`,
    },
    {
      label: 'Clustered metal loss',
      count: items.filter((item) => item.nominal.isClusteredMetalLoss).length,
      detail: 'Vendor-merged groups assessed as one defect, with no run-pair growth rate.',
    },
    {
      label: 'Zero-baseline growth estimate',
      count: active.filter(
        (item) => item.nominal.growthEvidence?.depth.observation === 'new-only-zero-baseline-estimate',
      ).length,
      detail: 'Depth rates assumed from a zero-depth OLD-survey baseline, not measured across a run pair.',
    },
    {
      label: 'Apparent depth decrease',
      count: active.filter(
        (item) => item.nominal.growthEvidence?.depth.observation === 'apparent-decrease',
      ).length,
      detail: 'The matched run pair reports a shallower feature; review ILI sizing uncertainty.',
    },
    {
      label: 'Engineer-entered fallback rate',
      count: active.filter(
        (item) => item.nominal.growthEvidence?.depth.analysisBasis === 'explicit-fallback',
      ).length,
      detail: 'Projection uses an assumed rate because source growth was unavailable.',
    },
  ].filter((gap) => gap.count > 0);

  return {
    verdict,
    failingCount,
    activeCount: active.length,
    assessedCount: items.length,
    pressureBasisMpa: items[0]?.nominal.p0 ?? 0,

    remnantLife: reportCase.remnantLife,
    remnantLifeAfterRepairProgramme: reportCase.remnantLifeAfterRepairProgramme,
    repairProgrammeCount: reportCase.repairProgrammeTargets.length,
    designLife: designLifeUsage(config.serviceLife ?? EMPTY_SERVICE_LIFE, config.iliDate),
    nextInspectionByIso: nextInspectionBy(reportCase.remnantLife, config.iliDate),
    nextInspectionInsideMargin:
      reportCase.remnantLife.years !== null &&
      reportCase.remnantLife.years <= NEXT_INSPECTION_MARGIN_YEARS,

    lowestSafePressure: extreme(
      active,
      (item) => item.nominal.safePressure,
      'min',
      (_item, value) => formatPressure(value),
    ),
    worstErf: extreme(
      active,
      // An infinite ERF is a collapsed feature, not a large number; it is
      // excluded here so it cannot silently become the reported maximum.
      (item) => (Number.isFinite(item.nominal.ERF) ? item.nominal.ERF : null),
      'max',
      (item, value) => `${value.toFixed(3)} · ${item.nominal.maxDepthPct.toFixed(1)} %WT`,
    ),
    deepest: extreme(
      active,
      (item) => item.nominal.maxDepthPct,
      'max',
      (item, value) => `${value.toFixed(1)} %WT · ${item.nominal.surface}`,
    ),
    fastestDepthGrowth: extreme(
      active,
      (item) => (item.nominal.crDepth > 0 ? item.nominal.crDepth : null),
      'max',
      (_item, value) => `${value.toFixed(3)} mm/y`,
    ),
    fastestLengthGrowth: extreme(
      active,
      (item) => (item.nominal.remnantLife.lengthHeldConstant
        ? null
        : item.nominal.remnantLife.lengthRateMmPerYear),
      'max',
      (item, value) => `${value.toFixed(3)} mm/y · now ${item.nominal.length.toFixed(0)} mm`,
    ),

    internalCount: items.filter(isInternal).length,
    externalCount: items.filter((item) => !isInternal(item)).length,
    bottomQuadrantCount: items.filter((item) => item.bottomQuadrant).length,
    clusteredCount: items.filter((item) => item.nominal.isClusteredMetalLoss).length,
    depthBands,
    sections: buildSectionGrowthSummary(items),

    dataGaps,
  };
}

/** One-sentence verdict, phrased the way the report states it. */
export function verdictSentence(
  summary: FfsExecutiveSummary,
  config: FfsConfig,
  screening: FfsScreeningConfig,
): string {
  if (summary.verdict === 'no-population') return 'No feature was assessed.';
  const pressure = formatPressure(summary.pressureBasisMpa);
  if (summary.verdict === 'fit-for-service') {
    return `Fit for service at ${pressure}: no active feature reaches ERF 1.0 or ${screening.depthRejectionPct}% of wall thickness.`;
  }
  return `${summary.failingCount.toLocaleString()} active feature(s) exceed the acceptance criteria at ${pressure}. The line is not fit for continued service at this pressure without pressure control or repair.`;
}
