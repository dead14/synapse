import { isInternal } from './statistics.ts';
import { screenAgainstEnvelope } from './chartData.ts';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from './types.ts';
import {
  analysisHorizonYears,
  formatRemnantLife,
  lifeSortValue,
  remnantLimitLabel,
} from './lifeProjection.ts';
import { designLifeUsage, EMPTY_SERVICE_LIFE } from './remnantLife.ts';
import { resolvedDepthRate } from './growthResolution.ts';
import { buildSectionPipeSpecSummary, buildSectionGrowthSummary } from './sectionSummary.ts';
import {
  designFactorSourceLabel,
  outerDiameterSourceLabel,
  smysSourceLabel,
} from './assessmentProfile.ts';
import {
  buildFfsReportCase,
  createFfsReportContext,
  type FfsReportContext,
} from './reportCase.ts';
import { buildExecutiveNarrative } from './executiveNarrative.ts';
import { maxBy } from '../../utils/numericRange.ts';
import {
  failureStressTex,
  FFS_TEX,
  flowStressTex,
  flowStressText,
  FOLIAS_TEX,
} from './notation.ts';

export interface NarrativeTableColumn {
  header: string;
  align?: 'left' | 'center' | 'right';
}

export interface NarrativeTable {
  caption: string;
  columns: NarrativeTableColumn[];
  rows: string[][];
  /** Row indices to emphasise as governing features. */
  criticalRows?: number[];
}

export type NarrativeBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; table: NarrativeTable }
  /**
   * A block of equations, or a padded monospace readout.
   *
   * `lines` is what the Word and HTML exports print — those have no typesetter,
   * and a document holding `\frac{}{}` is worse than one holding a slash.
   * `linesTex` is the same content for the screen, and is only present on the
   * blocks that are genuinely equations: the governing-feature readout below is
   * a column-aligned listing and belongs in a `<pre>` on every surface.
   */
  | { kind: 'formula'; lines: string[]; linesTex?: string[] }
  | { kind: 'figure'; caption: string; chartId: string };

export interface NarrativeOptions {
  /** Rows shown in the ERF-ranked table. */
  erfTableRows: number;
  /** Rows shown in the remaining-life-ranked table. */
  lifeTableRows: number;
}

export const DEFAULT_NARRATIVE_OPTIONS: NarrativeOptions = {
  erfTableRows: 10,
  lifeTableRows: 10,
};

const NARRATIVE_REPAIR_REGISTER_LIMIT = 100;

function methodName(config: FfsConfig): string {
  return config.method === 'original' ? 'Original ASME B31G' : 'Modified ASME B31G';
}

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '–';
}

/**
 * Composes the engineering narrative from the assessment output. Every figure
 * quoted here is derived from the current results, so the text stays in step
 * with the parameters on screen.
 */
export function buildNarrative(
  items: FfsScreenedResult[],
  config: FfsConfig,
  screening: FfsScreeningConfig,
  options: NarrativeOptions = DEFAULT_NARRATIVE_OPTIONS,
  reportContext: FfsReportContext = createFfsReportContext(config),
): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];
  const total = items.length;

  if (!total) {
    return [
      { kind: 'heading', level: 1, text: 'Fitness-for-service assessment' },
      { kind: 'paragraph', text: 'No assessed features are available for this report.' },
    ];
  }

  const unacceptable = items.filter((item) => item.nominal.acceptance === 'Un-Acceptable');
  const acceptable = total - unacceptable.length;
  const horizonYears = analysisHorizonYears(config);
  const reportCase = buildFfsReportCase(items, reportContext);
  const activeItems = reportCase.asManagedItems;
  const repairItems = items.filter((item) => item.nominal.repairStatus !== 'unrepaired');
  const narrativeRepairItems = repairItems.slice(0, NARRATIVE_REPAIR_REGISTER_LIMIT);
  const activeUnacceptable = activeItems.filter((item) => item.nominal.acceptance === 'Un-Acceptable');
  const belowReviewThreshold = (item: FfsScreenedResult) =>
    item.nominal.remnantLife.years !== null &&
    item.nominal.remnantLife.years < config.highlightYears;
  const activeBelowThreshold = activeItems.filter(belowReviewThreshold);
  const activeEscalated = activeItems.filter((item) => item.conservative.severity !== 'pass');
  const activeMaxDepth = activeItems.length > 0
    ? maxBy(activeItems, (item) => item.nominal.maxDepthPct)
    : null;
  const belowThreshold = items.filter(belowReviewThreshold);
  const escalated = items.filter((item) => item.conservative.severity !== 'pass');
  const internalCount = items.filter(isInternal).length;
  const externalCount = total - internalCount;
  const bottomCount = items.filter((item) => item.bottomQuadrant).length;

  const byErf = [...items].sort((a, b) => b.nominal.ERF - a.nominal.ERF);
  const byLife = [...items].sort(
    (a, b) =>
      lifeSortValue(a.nominal.remnantLife.years) - lifeSortValue(b.nominal.remnantLife.years),
  );
  const governing = byErf[0];

  // ── 1  Executive summary ─────────────────────────────────────────
  // Written to the client's own ILI report template: 1.1 summary of results
  // through 1.7 management statement, in their order and under their headings,
  // so this document reads beside the contractor's report rather than against
  // it. The engineering detail those sections summarise stays where it was, in
  // sections 2 onwards, and the summary quotes it rather than restating it.
  blocks.push(
    ...buildExecutiveNarrative(items, config, screening, reportContext, reportCase, options),
  );

  // ── 2.0 Methodology ───────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '2.0  Assessment methodology' });
  blocks.push({
    kind: 'paragraph',
    text:
      `The ${methodName(config)} remaining-strength criterion was applied to each reported feature as a ` +
      `Level 1 evaluation, using the nominal geometry, material properties, and required pressure supplied ` +
      `with the inspection data. The flow stress basis is ${flowStressText(config)}. A Level 2 Effective ` +
      `Area evaluation, which needs a measured corrosion profile rather than a single maximum depth and ` +
      `axial extent, is reported separately where an interacting group provides one.`,
  });

  // The last two lines of this block used to read `P_safe = P_f × F` and
  // `ERF = S₀ / (Sf × F)`. Neither is what the engine does, and both are the
  // same defect `calcTrace` was rewritten to remove: the safe pressure is the
  // failure pressure divided by the safety factor, and ERF is the required
  // pressure over that safe pressure. On a line at F = 0.72 assessed at the
  // para. 1.9 minimum of 1.25, the printed relations understated the safe
  // pressure by 10 % and overstated ERF by 11 % against the numbers tabulated
  // three pages later in the same report. The trace was fixed; this block was
  // missed, and a report that contradicts itself is the one thing a
  // fitness-for-service document cannot do.
  blocks.push({
    kind: 'formula',
    lines:
      config.method === 'original'
        ? [
            'z  = L² / (D · t)',
            'M  = √(1 + 0.8 z)                             for z ≤ 20',
            'Sf = S_flow · (1 − ⅔ d/t) / (1 − ⅔ (d/t)/M)   for z ≤ 20',
            'Sf = S_flow · (1 − d/t)                       for z > 20',
            'S_flow = 1.1 × SMYS',
            'P_f = 2 · Sf · t / D          P_safe = P_f / SF',
            'ERF = P₀ / P_safe             S₀ = P₀ · D / (2t)',
          ]
        : [
            'z  = L² / (D · t)',
            'M  = √(1 + 0.6275 z − 0.003375 z²)            for z ≤ 50',
            'M  = 0.032 z + 3.3                            for z > 50',
            `S_flow = ${flowStressText(config)}`,
            'Sf = S_flow · (1 − 0.85 d/t) / (1 − 0.85 (d/t)/M)',
            'P_f = 2 · Sf · t / D          P_safe = P_f / SF',
            'ERF = P₀ / P_safe             S₀ = P₀ · D / (2t)',
          ],
    linesTex:
      config.method === 'original'
        ? [
            FFS_TEX.normalisedLength,
            `${FOLIAS_TEX.original} \\cond{z \\le 20}`,
            `${failureStressTex('original')} \\cond{z \\le 20}`,
            '\\Sfail = \\Sflow\\left(1 - \\frac{d}{t}\\right) \\cond{z > 20}',
            '\\Sflow = 1.1 \\times \\SMYS',
            FFS_TEX.failurePressure,
            FFS_TEX.safePressure,
            FFS_TEX.hoopStress,
            FFS_TEX.erf,
          ]
        : [
            FFS_TEX.normalisedLength,
            `${FOLIAS_TEX.modifiedShort} \\cond{z \\le 50}`,
            `${FOLIAS_TEX.modifiedLong} \\cond{z > 50}`,
            flowStressTex(config),
            failureStressTex('modified'),
            FFS_TEX.failurePressure,
            FFS_TEX.safePressure,
            FFS_TEX.hoopStress,
            FFS_TEX.erf,
          ],
  });

  // A line does not have one design factor, and does not always have one
  // diameter either. Stating what each stretch is made of and what it was
  // assessed against is the difference between a reviewable result and a number
  // the reader has to take on trust.
  const pipeSpecRows = buildSectionPipeSpecSummary(items);
  const diameters = new Set(pipeSpecRows.map((row) => row.outerDiameterMm));
  const grades = new Set(pipeSpecRows.map((row) => row.smysMpa));
  blocks.push({ kind: 'heading', level: 2, text: '2.1  Pipe spec by section' });
  blocks.push({
    kind: 'table',
    table: {
      caption: 'Table 2-1  Outside diameter, grade, design factor and safety factor applied to each section',
      columns: [
        { header: 'Section', align: 'left' },
        { header: 'From [m]', align: 'right' },
        { header: 'To [m]', align: 'right' },
        { header: 'Features', align: 'right' },
        { header: 'OD [mm]', align: 'right' },
        { header: 'OD source', align: 'left' },
        { header: 'SMYS [MPa]', align: 'right' },
        { header: 'SMYS source', align: 'left' },
        { header: 'Design factor', align: 'right' },
        { header: 'Source', align: 'left' },
        { header: 'Safety factor', align: 'right' },
      ],
      rows: pipeSpecRows.map((row) => [
        row.section,
        row.startLd.toLocaleString(undefined, { maximumFractionDigits: 1 }),
        row.endLd.toLocaleString(undefined, { maximumFractionDigits: 1 }),
        row.featureCount.toLocaleString(),
        row.outerDiameterMm.toLocaleString(undefined, { maximumFractionDigits: 1 }),
        outerDiameterSourceLabel(row.outerDiameterSource),
        row.smysMpa.toLocaleString(undefined, { maximumFractionDigits: 1 }),
        smysSourceLabel(row.smysSource),
        row.designFactor.toFixed(2),
        designFactorSourceLabel(row.source),
        `${row.safetyFactor.toFixed(2)}${row.safetyFactorSource === 'explicit' ? '' : ' (1/F)'}`,
      ]),
    },
  });
  // Said in prose as well as in the table, because a multi-diameter line changes
  // how every downstream figure in this report has to be read: D sets the hoop
  // stress and the Folias term, so an ERF from one stretch is not comparable to
  // an ERF from the other at the same depth and length.
  if (diameters.size > 1) {
    blocks.push({
      kind: 'paragraph',
      text: `This line is not of one diameter. ${diameters.size} outside diameters were assessed — `
        + `${[...diameters].sort((a, b) => a - b).map((value) => `${value} mm`).join(', ')} — each on the `
        + 'stretch of line recorded above. Every remaining-strength figure in this report was calculated '
        + 'on the diameter of the section the feature sits in, and features in different sections are '
        + 'therefore not directly comparable on depth and length alone.',
    });
  }
  // The grade is stated on the same terms and for the same reason. SMYS sets
  // the flow stress, and the flow stress multiplies the failure pressure, so a
  // line of two grades gives two different safe pressures for one defect.
  if (grades.size > 1) {
    blocks.push({
      kind: 'paragraph',
      text: `This line is not of one grade. ${grades.size} specified minimum yield strengths were `
        + `assessed — ${[...grades].sort((a, b) => a - b).map((value) => `${value} MPa`).join(', ')} — each `
        + 'on the stretch of line recorded above. The flow stress, and with it the estimated failure '
        + 'pressure, is taken from the grade of the section the feature sits in.',
    });
  }

  blocks.push({ kind: 'heading', level: 2, text: '2.2  Screening assumptions' });
  blocks.push({
    kind: 'list',
    items: [
      `ILI depth tolerance of +${screening.depthTolerancePct}% of wall thickness applied as an absolute addition for the conservative screen.`,
      `ILI length tolerance of +${screening.lengthToleranceMm} mm per end, giving a conservative length of reported + ${2 * screening.lengthToleranceMm} mm.`,
      screening.growthBasis === 'measured'
        ? `Each feature is grown radially from its own source-evidenced rate for the ${screening.forecastYears}-year forecast. The evidence record distinguishes matched measurements, NEW-only zero-baseline estimates, manual rates, apparent decreases, and unavailable values; ${screening.growthRateMmPerYear > 0 ? `an explicit ${screening.growthRateMmPerYear.toFixed(2)} mm/year fallback applies only where the source rate is unavailable` : 'no implicit fallback is applied where the source rate is unavailable'}.`
        : `A uniform corrosion growth rate of ${screening.growthRateMmPerYear.toFixed(2)} mm/year is applied radially to every feature for the ${screening.forecastYears}-year forecast.`,
      `Remaining-life calculations are bounded to a ${horizonYears}-year analysis horizon. A limit not reached inside that window is not reported as a service-life value or date.`,
      `Engineering review band starts at ERF ${screening.reviewBandErf.toFixed(2)}; ERF above 1.00 is reported as exceeding the calculated safe pressure.`,
      `Interaction screened at ${screening.interactionSpacingFactor}t edge-to-edge separation in both the axial and circumferential directions, per B31G para. 1.12(a).`,
      `Metal loss deeper than ${screening.depthRejectionPct}% of wall is rejected by project rule. B31G itself sets no depth ceiling on evaluation; it requires the sizing accuracy and corrosion rate to be justified above 80 %, and withdraws only the section 3 tables.`,
      'Remaining life, the ERF term, and the original design life cap are operator conventions layered on the code result. B31G defines none of them.',
      'Temperature derating, residual stress, and pressure cycling are not applied.',
    ],
  });

  // ── 3.0 Results ───────────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '3.0  Assessment results' });
  blocks.push({
    kind: 'paragraph',
    text:
      `Of the ${total.toLocaleString()} assessed features, ${acceptable.toLocaleString()} ` +
      `(${((acceptable / total) * 100).toFixed(1)}%) satisfy the acceptance criteria at the current operating ` +
      `pressure, and ${unacceptable.length.toLocaleString()} ` +
      `(${((unacceptable.length / total) * 100).toFixed(1)}%) do not. ` +
      `${belowThreshold.length.toLocaleString()} feature(s) have a remnant life below the ` +
      `${config.highlightYears}-year review threshold. Applying the ILI tolerance screen, ` +
      `${escalated.length.toLocaleString()} feature(s) fall at or above the ERF ` +
      `${screening.reviewBandErf.toFixed(2)} review band.`,
  });

  // The Level 0 screen reads before the Level 1 numbers because that is the
  // order the code applies them: length and depth first, from the published
  // table, and only then the calculation.
  const level0 = screenAgainstEnvelope(items, config, screening.depthRejectionPct, 'level-0');
  blocks.push({
    kind: 'paragraph',
    text:
      `The Level 0 screen of ${methodName(config)} checks reported length against reported depth ` +
      `alone. Its allowable curve carries no pressure term: the published tables are drawn for a ` +
      `line at its design hoop stress with the matching safety factor, which places the target ` +
      `failure stress at SMYS, so the boundary depends only on the diameter, the wall, and the ` +
      `grade. ` +
      (level0.exceeded === 0
        ? `All ${level0.total.toLocaleString()} assessed features plot on or below that curve and ` +
          `pass the screen.`
        : `${level0.exceeded.toLocaleString()} feature(s) — ` +
          `${(level0.fraction * 100).toFixed(1)}% of the assessed population — plot above it and do ` +
          `not pass the screen. Failing the screen is not in itself a rejection: it means the ` +
          `anomaly cannot be dispositioned from its length and depth alone, and the Level 1 result ` +
          `below governs.`) +
      (level0.indeterminate > 0
        ? ` A further ${level0.indeterminate.toLocaleString()} feature(s) resolve no allowable depth ` +
          `at all at their reported length and are not screened.`
        : ''),
  });

  blocks.push({
    kind: 'paragraph',
    text:
      `The governing feature is located at log distance ${Number(governing.nominal.ld).toLocaleString()} m ` +
      `(${governing.nominal.section}), with a reported depth of ${governing.nominal.maxDepthPct.toFixed(1)}% ` +
      `of wall thickness over an axial length of ${governing.nominal.length.toFixed(0)} mm. Its nominal ERF is ` +
      `${fmt(governing.nominal.ERF)}, rising to ${fmt(governing.conservative.ERF)} under the ILI tolerance ` +
      `screen and ${fmt(governing.forecast.ERF)} after ${screening.forecastYears} years of assumed growth. ` +
      `The calculated safe operating pressure at this feature is ` +
      `${fmt(governing.nominal.safePressure, 2)} MPa against an operating pressure of ` +
      `${fmt(governing.nominal.p0, 2)} MPa.`,
  });

  blocks.push({ kind: 'heading', level: 2, text: '3.1  Features ranked by ERF' });
  blocks.push({
    kind: 'table',
    table: {
      caption: `Table 3-1  Highest ${Math.min(options.erfTableRows, total)} features by nominal ERF`,
      columns: [
        { header: 'LD [m]', align: 'right' },
        { header: 'Section', align: 'left' },
        { header: 'Surface', align: 'left' },
        { header: 'Depth [%]', align: 'right' },
        { header: 'Length [mm]', align: 'right' },
        { header: 'ERF', align: 'right' },
        { header: 'Conservative ERF', align: 'right' },
        { header: 'P_safe [MPa]', align: 'right' },
        { header: 'Acceptance', align: 'center' },
      ],
      rows: byErf.slice(0, options.erfTableRows).map((item) => [
        Number(item.nominal.ld).toLocaleString(),
        item.nominal.section,
        item.nominal.surface,
        item.nominal.maxDepthPct.toFixed(1),
        item.nominal.length.toFixed(0),
        fmt(item.nominal.ERF),
        fmt(item.conservative.ERF),
        fmt(item.nominal.safePressure, 2),
        item.nominal.acceptance,
      ]),
      criticalRows: byErf
        .slice(0, options.erfTableRows)
        .map((item, i) => (item.nominal.acceptance === 'Un-Acceptable' ? i : -1))
        .filter((i) => i >= 0),
    },
  });

  blocks.push({ kind: 'heading', level: 2, text: '3.2  Features ranked by remnant life' });
  blocks.push({
    kind: 'table',
    table: {
      caption: `Table 3-2  Shortest ${Math.min(options.lifeTableRows, total)} features by remnant life`,
      columns: [
        { header: 'LD [m]', align: 'right' },
        { header: 'Section', align: 'left' },
        { header: 'Surface', align: 'left' },
        { header: 'Depth [%]', align: 'right' },
        { header: 'Length [mm]', align: 'right' },
        { header: 'Orient.', align: 'center' },
        { header: 'CR depth [mm/y]', align: 'right' },
        { header: 'CR length [mm/y]', align: 'right' },
        { header: 'Remnant life [y]', align: 'right' },
        { header: 'Due date', align: 'center' },
        { header: 'Governing limit', align: 'left' },
        { header: 'Remarks', align: 'left' },
      ],
      rows: byLife.slice(0, options.lifeTableRows).map((item) => {
        const n = item.nominal;
        const remarks = [
          n.repairStatus === 'temporary-repair' ? 'Temporary repair' : '',
          n.repairStatus === 'permanent-repair-verified' ? 'Permanent repair' : '',
          n.isClusteredMetalLoss ? 'Clustered metal loss' : '',
          n.remnantLife.lengthHeldConstant && n.remnantLife.status === 'calculated'
            ? 'Length held constant'
            : '',
          n.remnantLife.designLifeCapApplied ? 'Capped at design life' : '',
          n.remnantLife.pastDesignLifeAtInspection ? 'Past original design life' : '',
        ].filter(Boolean);
        return [
          Number(n.ld).toLocaleString(),
          n.section,
          n.surface,
          n.maxDepthPct.toFixed(1),
          n.length.toFixed(0),
          n.orient || '—',
          resolvedDepthRate(n).toFixed(3),
          n.remnantLife.lengthHeldConstant ? 'Not calculated' : n.remnantLife.lengthRateMmPerYear.toFixed(3),
          formatRemnantLife(n.remnantLife),
          n.remnantLife.dueDateIso ?? '—',
          remnantLimitLabel(n.remnantLife),
          remarks.join('; ') || '—',
        ];
      }),
      criticalRows: byLife
        .slice(0, options.lifeTableRows)
        .map((item, i) => (belowReviewThreshold(item) ? i : -1))
        .filter((i) => i >= 0),
    },
  });

  // ── 3.3 Corrosion growth by section ───────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '3.3  Corrosion growth by section' });
  const sectionGrowth = buildSectionGrowthSummary(items);
  const rate = (value: number | null) => (value === null ? 'None' : value.toFixed(3));
  blocks.push({
    kind: 'paragraph',
    text:
      'Growth is reported as the maximum rate observed in each section rather than a mean. ' +
      'A section average dilutes a severe local rate against a long quiet stretch, which is ' +
      'precisely the signal this table exists to show. Axial rates count only features where a ' +
      'rate was established; where none was, the feature is counted as unavailable and never ' +
      'as a zero.',
  });
  blocks.push({
    kind: 'table',
    table: {
      caption: 'Table 3-3  Maximum corrosion growth by section and surface location',
      columns: [
        { header: 'Section', align: 'left' },
        { header: 'Features', align: 'right' },
        { header: 'INT depth [mm/y]', align: 'right' },
        { header: 'EXT depth [mm/y]', align: 'right' },
        { header: 'INT length [mm/y]', align: 'right' },
        { header: 'EXT length [mm/y]', align: 'right' },
        { header: 'Length rate n/a', align: 'right' },
        { header: 'Max depth [%]', align: 'right' },
        { header: 'Shortest remnant [y]', align: 'right' },
      ],
      rows: sectionGrowth.map((row) => [
        row.section,
        `${row.featureCount.toLocaleString()} (${row.internalCount}/${row.externalCount})`,
        rate(row.internalDepthRateMmPerYear),
        rate(row.externalDepthRateMmPerYear),
        rate(row.internalLengthRateMmPerYear),
        rate(row.externalLengthRateMmPerYear),
        row.lengthRateUnavailableCount.toLocaleString(),
        row.maxDepthPct.toFixed(1),
        row.shortestRemnantLifeYears === null ? '—' : row.shortestRemnantLifeYears.toFixed(2),
      ]),
    },
  });

  blocks.push({ kind: 'heading', level: 2, text: '3.4  Repair disposition' });
  blocks.push({
    kind: 'table',
    table: {
      caption: 'Table 3-4  Repair disposition register',
      columns: [
        { header: 'Feature ID', align: 'left' },
        { header: 'LD [m]', align: 'right' },
        { header: 'Status', align: 'left' },
        { header: 'Method', align: 'left' },
        { header: 'Date', align: 'center' },
        { header: 'Evidence reference', align: 'left' },
        { header: 'Action owner', align: 'left' },
        { header: 'As-managed treatment', align: 'left' },
      ],
      rows: narrativeRepairItems.map((item) => [
        item.nominal.featureId ?? '—',
        Number(item.nominal.ld).toLocaleString(),
        item.nominal.repairStatus === 'permanent-repair-verified'
          ? 'Permanent repair verified'
          : item.nominal.repairStatus === 'temporary-repair'
            ? 'Temporary repair'
            : 'Unrepaired',
        item.nominal.repairMethod ?? '—',
        item.nominal.repairDate ?? '—',
        item.nominal.repairReference ?? '—',
        item.nominal.actionOwner ?? '—',
        reportCase.repairCreditDecisions.get(item)?.credited
          ? 'Excluded after evidence validation'
          : 'Active; no capacity credit',
      ]),
      criticalRows: narrativeRepairItems
        .map((item, index) => (item.nominal.repairStatus === 'temporary-repair' ? index : -1))
        .filter((index) => index >= 0),
    },
  });
  if (repairItems.length > narrativeRepairItems.length) {
    blocks.push({
      kind: 'paragraph',
      text:
        `The narrative lists the first ${narrativeRepairItems.length.toLocaleString()} of ` +
        `${repairItems.length.toLocaleString()} repair records to keep the document reviewable. ` +
        'The complete repair register remains in the Excel assessment appendix.',
    });
  }

  // ── 3.5 Residual life assessment ──────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '3.5  Residual life assessment' });
  const service = config.serviceLife ?? EMPTY_SERVICE_LIFE;
  const usage = designLifeUsage(service, config.iliDate);
  blocks.push({
    kind: 'paragraph',
    text:
      'ASME B31G contains no remaining-life method: it evaluates remaining strength at the dimensions ' +
      'given to it. The projection below is therefore an operator procedure built on the code result, ' +
      'not a code calculation, and it is reported as such. The remnant life of the line is the shortest ' +
      'remnant life among its active features. Each feature is projected from its as-reported dimensions ' +
      'at its own growth rates, and the earlier of two limits governs: metal loss reaching 80% of nominal ' +
      'wall, which is the project rejection line, or the safe pressure falling to the required pressure ' +
      `(ERF 1.0), which is the code acceptance criterion. Results are bounded to a ` +
      `${horizonYears}-year analysis horizon` +
      (service.designLifeYears === null
        ? '. No original design life was supplied, so no design-life limit is applied.'
        : usage !== null && usage.designLifeRemainingYears <= 0
          ? `. The line is already past its ${service.designLifeYears}-year original design life, so no `
            + 'design-life bound is applied and the figures below are corrosion-governed only.'
          : ` and are not reported above the design life remaining at the inspection, out of the `
            + `${service.designLifeYears}-year original design life.`),
  });

  const lifeGoverning = reportCase.remnantLife.governing;
  if (lifeGoverning) {
    const remnant = lifeGoverning.nominal.remnantLife;
    // The line this projection was measured to, not the 80 %WT default.
    const depthLimitPct = Number(
      (Number.isFinite(remnant.depthLimitPct) ? remnant.depthLimitPct : 80).toFixed(2),
    );
    blocks.push({
      kind: 'formula',
      lines: [
        `Governing feature   LD ${Number(governing.nominal.ld).toLocaleString()} m, ${lifeGoverning.nominal.section}, ${lifeGoverning.nominal.surface}`,
        `Nominal wall t      ${lifeGoverning.nominal.wall.toFixed(2)} mm`,
        `Reported depth      ${lifeGoverning.nominal.maxDepthPct.toFixed(1)} %WT over ${lifeGoverning.nominal.length.toFixed(0)} mm`,
        `Depth CGR           ${remnant.depthRateMmPerYear.toFixed(3)} mm/y`,
        `Length CGR          ${remnant.lengthHeldConstant ? 'not established — length held constant' : `${remnant.lengthRateMmPerYear.toFixed(3)} mm/y`}`,
        '',
        // The depth line is configurable; printing 0.80 here published a sum
        // that does not evaluate to the years quoted at the end of the row.
        `${`${depthLimitPct} %WT limit`.padEnd(20)}(${(depthLimitPct / 100).toFixed(2)} - ${(governing.nominal.maxDepthPct / 100).toFixed(2)}) x ${lifeGoverning.nominal.wall.toFixed(2)} mm / ${remnant.depthRateMmPerYear.toFixed(3)} mm/y = ${remnant.depthLimitYears === null ? `not reached in ${horizonYears} y` : `${remnant.depthLimitYears.toFixed(2)} y`}`,
        `ERF 1.0 limit       ${remnant.erfLimitYears === null ? `not reached in ${horizonYears} y` : `${remnant.erfLimitYears.toFixed(2)} y`}`,
        remnant.designLifeCapYears !== null
          ? `Design life limit   ${remnant.designLifeCapYears.toFixed(2)} y remaining of ${service.designLifeYears} y`
          : '',
        remnant.pastDesignLifeAtInspection ? 'Design life limit   past design life — not applied' : '',
        '',
        `Remnant life        ${formatRemnantLife(remnant)}  (${remnantLimitLabel(remnant)})`,
        `Due date            ${remnant.dueDateIso ?? '—'}`,
      ].filter((line) => line !== ''),
    });
  } else {
    blocks.push({
      kind: 'paragraph',
      text:
        'No active feature establishes a limit inside the analysis horizon, so no remnant life ' +
        'or due date is reported for the line.',
    });
  }

  if (usage) {
    blocks.push({
      kind: 'paragraph',
      text:
        `For context, the line was commissioned in ${usage.commissioningYear} and was ` +
        `${usage.ageAtInspectionYears.toFixed(1)} years old at inspection against an original design ` +
        `life of ${usage.designLifeYears} years` +
        (usage.designLifeRemainingYears < 0
          ? `, so it is already ${Math.abs(usage.designLifeRemainingYears).toFixed(1)} years beyond it. ` +
            'Continued service past the original design life is a management decision that this ' +
            'calculation supports but does not make.'
          : `, leaving ${usage.designLifeRemainingYears.toFixed(1)} years of design life.`),
    });
  }

  const afterRepairs = reportCase.remnantLifeAfterRepairProgramme;
  if (reportCase.repairProgrammeTargets.length > 0) {
    blocks.push({
      kind: 'paragraph',
      text:
        `${reportCase.repairProgrammeTargets.length.toLocaleString()} active feature(s) are ` +
        `recommended for permanent repair — those with a remnant life below ` +
        `${config.highlightYears} years, together with every temporary repair still in place. ` +
        (afterRepairs.years !== null
          ? `If all of them are cut out and replaced, the remnant life of the line extends to ` +
            `${afterRepairs.years.toFixed(2)} years, or ${afterRepairs.dueDateIso}, set by the ` +
            `feature at LD ${Number(afterRepairs.governing?.nominal.ld).toLocaleString()} m.`
          : 'With those features removed, no remaining active feature establishes a limit inside ' +
            'the analysis horizon.'),
    });
  }

  // ── 4.0 Figures ───────────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '4.0  Figures' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-1  Depth category distribution by log distance', chartId: 'depth-by-ld' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-2  Depth category distribution in three dimensions', chartId: 'depth-3d' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-3  Feature orientation by log distance', chartId: 'orientation' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-4  Anomaly screening against the B31G Level 0 envelope', chartId: 'screening' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-5  ERF against log distance', chartId: 'erf-ld' });

  // ── 5.0 Discussion ────────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '5.0  Discussion' });
  blocks.push({
    kind: 'paragraph',
    text:
      `The reported population is split ${internalCount.toLocaleString()} internal to ` +
      `${externalCount.toLocaleString()} external features. ` +
      (internalCount > externalCount
        ? 'Internal corrosion dominates, which points to product-side conditions — water hold-up, ' +
          'solids deposition, or inhibitor availability — as the primary mechanism to verify.'
        : 'External corrosion dominates, which points to coating condition, cathodic-protection ' +
          'coverage, and soil or water contact as the primary mechanisms to verify.'),
  });
  if (bottomCount > 0) {
    blocks.push({
      kind: 'paragraph',
      text:
        `${bottomCount.toLocaleString()} feature(s) (${((bottomCount / total) * 100).toFixed(0)}%) sit in the ` +
        `4:00-8:00 bottom quadrant. ` +
        (bottomCount / total > 0.5
          ? 'This concentration is consistent with water hold-up or settled solids along the invert and ' +
            'supports targeted drainage, inhibitor, and excavation validation planning. Confirm the ' +
            'mechanism with field evidence before committing to a mitigation strategy.'
          : 'The distribution does not indicate a strong invert bias; review orientation together with ' +
            'terrain profile and known coating history.'),
    });
  }
  blocks.push({
    kind: 'paragraph',
    text:
      `Applying the ILI tolerance screen moves ${escalated.length.toLocaleString()} feature(s) into the review ` +
      `band or above. The gap between the nominal and tolerance-adjusted results indicates how sensitive the ` +
      `disposition is to inspection accuracy: where that gap changes the outcome, a tool-specific performance ` +
      `specification should replace the assumed tolerance before final disposition.`,
  });

  // ── 6.0 Conclusions and recommendations ───────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '6.0  Conclusions and recommendations' });

  const recommendations: string[] = [];
  if (activeUnacceptable.length > 0) {
    recommendations.push(
      `${activeUnacceptable.length.toLocaleString()} active as-managed feature(s) exceed the acceptance criteria at the current ` +
        `operating pressure. Apply pressure control and raise an approved repair or a detailed ` +
        `(Level 2 or 3) assessment for these locations before continued operation at present conditions.`,
    );
  } else if (activeItems.length === 0) {
    recommendations.push(
      'No active feature remains after evidence-qualified permanent repairs. Retain the repair dossier and independent approval as the disposition record.',
    );
  } else {
    recommendations.push(
      'No active feature exceeds the acceptance criteria at the current operating pressure on the nominal ' +
        'calculation. Maintain existing integrity controls and the approved inspection plan.',
    );
  }
  if (activeBelowThreshold.length > 0) {
    recommendations.push(
      `${activeBelowThreshold.length.toLocaleString()} active feature(s) have a remnant life below ` +
        `${config.highlightYears} years. Confirm the corrosion growth basis against matched prior ILI data and ` +
        `set reassessment or intervention dates accordingly.`,
    );
  }
  if (activeEscalated.length > 0) {
    recommendations.push(
      `Verify the ILI tool performance specification for the ${activeEscalated.length.toLocaleString()} active feature(s) ` +
        `in the review band, since the disposition is sensitive to the assumed depth and length tolerance.`,
    );
  }
  if (activeMaxDepth !== null && activeMaxDepth >= 70) {
    recommendations.push(
      `The deepest active feature is at ${activeMaxDepth.toFixed(1)}% of wall thickness. Validate depth and ` +
        `morphology by excavation or in-ditch NDE, and record coating, CP, and environmental condition at ` +
        `the same time.`,
    );
  }
  recommendations.push(
    'Resolve the open data gaps — tool performance specification, feature association to welds and dents, ' +
      'and an approved corrosion-rate basis — before this assessment is issued as a final disposition.',
  );

  blocks.push({ kind: 'list', items: recommendations });
  blocks.push({ kind: 'heading', level: 2, text: '6.1  Report readiness' });
  blocks.push({
    kind: 'paragraph',
    text:
      reportCase.readiness.status === 'ready'
        ? 'Report readiness: ready. No blocking data-consistency or repair-evidence finding was identified.'
        : `Report readiness: ${reportCase.readiness.status === 'blocked' ? 'blocked' : 'ready with warnings'}. ` +
          `${reportCase.readiness.findings.length.toLocaleString()} finding(s) require acknowledgement or resolution.`,
  });
  if (reportCase.readiness.findings.length > 0) {
    blocks.push({
      kind: 'table',
      table: {
        caption: 'Table 6-1  Report-readiness findings',
        columns: [
          { header: 'Severity', align: 'center' },
          { header: 'Code', align: 'left' },
          { header: 'Finding', align: 'left' },
          { header: 'Affected', align: 'right' },
        ],
        rows: reportCase.readiness.findings.map((item) => [
          item.severity.toUpperCase(),
          item.code,
          item.message,
          item.affectedCount.toLocaleString(),
        ]),
        criticalRows: reportCase.readiness.findings
          .map((item, index) => (item.severity === 'error' ? index : -1))
          .filter((index) => index >= 0),
      },
    });
  }
  blocks.push({
    kind: 'paragraph',
    text:
      'This assessment is a screening calculation. Final fitness-for-service disposition requires an ' +
      'approved procedure, verified input data, a competent technical authority, and independent checking.',
  });

  return blocks;
}
