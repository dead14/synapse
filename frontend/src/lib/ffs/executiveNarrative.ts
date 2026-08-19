/**
 * Section 1 of the report, written to the client's ILI executive-summary
 * template.
 *
 * The client reads this document beside the ILI contractor's own report, and
 * that report's opening chapter has a fixed shape: a summary of results, then
 * fitness for service split into the immediate assessment, corrosion growth,
 * the future assessment and feature prioritisation, then risk, the next
 * inspection, the conclusion, the status table and the management statement.
 * Those headings, in that order, are what this module emits, so the two
 * documents can be read side by side without re-mapping the sections.
 *
 * What the template does not get is a placeholder filled in with a guess. Every
 * figure here is read from the assessed population, from the screening
 * configuration, or from the report case — and a field this workspace never
 * receives (the tool technology, the inspection contractor, the risk category)
 * is reported as not recorded, in the section the template puts it in, rather
 * than left as a bracket a reader could mistake for a result.
 *
 * The classification in 1.2.4 is deliberately not a new rule. It is the
 * priority the screening layer already assigned to every feature, split once
 * more at the acceptance criterion, so these bands can never disagree with the
 * action register or the results table.
 */

import {
  buildExecutiveSummary,
  formatPipelineRemnantLife,
  formatPressure,
  NEXT_INSPECTION_MARGIN_YEARS,
} from './executiveSummary.ts';
import { analysisHorizonYears, formatRemnantLife, remnantLimitLabel } from './lifeProjection.ts';
import { resolvedDepthRate } from './growthResolution.ts';
import { buildSectionGrowthSummary, buildSectionPipeSpecSummary } from './sectionSummary.ts';
import {
  growthAnalysisBasisLabel,
  growthObservationLabel,
  methodProfileLabel,
  pressureBasisLabel,
} from './assessmentProfile.ts';
import { SEVERE_DEPTH_PCT } from './screening.ts';
import { DEFAULT_DEPTH_BUCKETS, isInternal } from './statistics.ts';
import { designLifeUsage, EMPTY_SERVICE_LIFE } from './remnantLife.ts';
import { MEGAPASCALS_PER_BAR } from './units.ts';
import { FFS_TEX } from './notation.ts';
import { maxOf, minOf } from '../../utils/numericRange.ts';
import type { FfsReportCase, FfsReportContext } from './reportCase.ts';
import type { NarrativeBlock, NarrativeOptions } from './narrative.ts';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from './types.ts';

/** The four bands the client's template prioritises features into. */
export type FfsExecutiveBand = 'immediate' | 'high' | 'medium' | 'low';

/**
 * The template's band for one feature.
 *
 * `immediate` is the acceptance criterion itself — the as-reported safe
 * pressure has already fallen to or below the required pressure. Everything
 * below it is the priority the screening layer assigned, renamed into the
 * template's vocabulary. No second rule is invented here: a band that
 * disagreed with the results table would be a third opinion inside one
 * document.
 */
export function executiveBand(item: FfsScreenedResult): FfsExecutiveBand {
  if (item.nominal.acceptance === 'Un-Acceptable') return 'immediate';
  if (item.priority === 'High') return 'high';
  if (item.priority === 'Medium') return 'medium';
  return 'low';
}

const BAND_LABEL: Record<FfsExecutiveBand, string> = {
  immediate: 'Immediate',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const BAND_ORDER: FfsExecutiveBand[] = ['immediate', 'high', 'medium', 'low'];

function num(value: number | null | undefined, digits = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function ldOf(item: FfsScreenedResult): string {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';
}

function barg(mpa: number): string {
  return (mpa / MEGAPASCALS_PER_BAR).toFixed(2);
}

function sectionOf(item: FfsScreenedResult): string {
  const name = String(item.nominal.section ?? '').trim();
  return name && name !== '-' ? name : 'Unassigned';
}

function deepestOf(items: FfsScreenedResult[]): FfsScreenedResult | null {
  let best: FfsScreenedResult | null = null;
  for (const item of items) {
    if (!Number.isFinite(item.nominal.maxDepthPct)) continue;
    if (!best || item.nominal.maxDepthPct > best.nominal.maxDepthPct) best = item;
  }
  return best;
}

function fastestDepthGrowthOf(items: FfsScreenedResult[]): FfsScreenedResult | null {
  let best: FfsScreenedResult | null = null;
  let bestRate = 0;
  for (const item of items) {
    const rate = resolvedDepthRate(item.nominal);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (rate > bestRate) {
      best = item;
      bestRate = rate;
    }
  }
  return best;
}

/** Mean of the positive rates only; null when none was established. */
function meanDepthRate(items: FfsScreenedResult[]): { mean: number | null; count: number } {
  let total = 0;
  let count = 0;
  for (const item of items) {
    const rate = resolvedDepthRate(item.nominal);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    total += rate;
    count += 1;
  }
  return { mean: count > 0 ? total / count : null, count };
}

/** A feature located the way the summary sentences locate one. */
function whereIs(item: FfsScreenedResult | null): string {
  if (!item) return 'not established';
  return `LD ${ldOf(item)} m (${sectionOf(item)})`;
}

/**
 * The distinct values of a per-feature figure.
 *
 * A line is routinely not uniform in diameter, grade or design factor, so these
 * are reported as the set the assessment actually ran on. Past four values the
 * set is printed as a range with its count, because a summary listing thirty
 * wall thicknesses is not a summary.
 */
function distinct(values: number[], digits: number, unit: string): string {
  const finite = values.filter((value) => Number.isFinite(value));
  const unique = [...new Set(finite.map((value) => value.toFixed(digits)))];
  if (unique.length === 0) return 'not established';
  const suffix = unit ? ` ${unit}` : '';
  if (unique.length <= 4) return `${unique.join(', ')}${suffix}`;
  const sorted = unique.map(Number).sort((a, b) => a - b);
  return `${sorted[0].toFixed(digits)} – ${sorted[sorted.length - 1].toFixed(digits)}${suffix}, ${unique.length} distinct values`;
}

/** The survey years behind the growth rates, per section. */
interface GrowthIntervalRow {
  section: string;
  previousSurveys: string;
  currentSurveys: string;
  intervalYears: string;
  matchedCount: number;
  derivedCount: number;
  maxDepthRate: number | null;
}

function buildGrowthIntervals(items: FfsScreenedResult[]): GrowthIntervalRow[] {
  const bySection = new Map<string, FfsScreenedResult[]>();
  for (const item of items) {
    const key = sectionOf(item);
    const bucket = bySection.get(key);
    if (bucket) bucket.push(item);
    else bySection.set(key, [item]);
  }

  const yearList = (values: (number | null | undefined)[]): string => {
    const unique = [
      ...new Set(
        values.filter(
          (value): value is number => typeof value === 'number' && Number.isFinite(value),
        ),
      ),
    ].sort((a, b) => a - b);
    return unique.length ? unique.join(', ') : 'not recorded';
  };

  return [...bySection.entries()]
    .map(([section, members]) => {
      const evidence = members.map((item) => item.nominal.growthEvidence);
      const intervals = [
        ...new Set(
          evidence
            .map((record) => record?.intervalYears)
            .filter(
              (value): value is number =>
                typeof value === 'number' && Number.isFinite(value) && value > 0,
            )
            .map((value) => value.toFixed(2)),
        ),
      ];
      const rates = members
        .map((item) => resolvedDepthRate(item.nominal))
        .filter((rate) => Number.isFinite(rate) && rate > 0);
      return {
        section,
        previousSurveys: yearList(evidence.map((record) => record?.oldSurveyYear)),
        currentSurveys: yearList(evidence.map((record) => record?.newSurveyYear)),
        intervalYears: intervals.length ? intervals.join(', ') : 'not established',
        matchedCount: members.filter(
          (item) => item.nominal.growthEvidence?.depth.observation === 'matched-measured',
        ).length,
        derivedCount: members.filter((item) => {
          const basis = item.nominal.growthEvidence?.depth.analysisBasis;
          return (
            basis === 'service-age' ||
            basis === 'population-percentile' ||
            basis === 'explicit-fallback'
          );
        }).length,
        maxDepthRate: rates.length ? maxOf(rates) : null,
      };
    })
    .sort((a, b) => a.section.localeCompare(b.section));
}

/**
 * Section 1 of the report.
 *
 * `reportCase` is passed in rather than rebuilt: building one is a dozen passes
 * over the population, and two independently built cases are two chances for
 * the summary and the body of one document to disagree.
 */
export function buildExecutiveNarrative(
  items: FfsScreenedResult[],
  config: FfsConfig,
  screening: FfsScreeningConfig,
  reportContext: FfsReportContext,
  reportCase: FfsReportCase,
  options: NarrativeOptions,
): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];
  const summary = buildExecutiveSummary(items, config, screening, reportContext, DEFAULT_DEPTH_BUCKETS);
  const active = reportCase.asManagedItems;
  const horizonYears = analysisHorizonYears(config);
  const sections = buildSectionGrowthSummary(items);
  const pipeSpec = buildSectionPipeSpecSummary(items);
  const iliDateLabel = config.iliDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const ldValues = items.map((item) => Number(item.nominal.ld)).filter(Number.isFinite);
  const ldMin = minOf(ldValues);
  const ldMax = maxOf(ldValues);
  const internal = items.filter(isInternal);
  const external = items.filter((item) => !isInternal(item));
  const deepestInternal = deepestOf(internal);
  const deepestExternal = deepestOf(external);
  const deepestOverall = deepestOf(items);
  const minDepthPct = items.length ? minOf(items.map((item) => item.nominal.maxDepthPct)) : null;
  const maxDepthPct = items.length ? maxOf(items.map((item) => item.nominal.maxDepthPct)) : null;
  const usage = designLifeUsage(config.serviceLife ?? EMPTY_SERVICE_LIFE, config.iliDate);
  const dominantMechanism = internal.length >= external.length ? 'internal' : 'external';

  blocks.push({ kind: 'heading', level: 1, text: '1  Executive summary' });
  blocks.push({
    kind: 'paragraph',
    text:
      `An in-line inspection of ${config.lineName || 'the assessed pipeline'} was carried out on ` +
      `${iliDateLabel}. This report assesses the ${items.length.toLocaleString()} metal-loss ` +
      `${items.length === 1 ? 'feature' : 'features'} it reported for fitness for service against ` +
      `${methodProfileLabel(config)}. The assessed features ` +
      `span log distance ${ldMin.toLocaleString()} m to ${ldMax.toLocaleString()} m across ` +
      `${sections.length.toLocaleString()} section(s). Repair disposition capacity credit is evaluated as ` +
      `of ${reportContext.asOfDateIso}.`,
  });
  blocks.push({
    kind: 'paragraph',
    text:
      'The inspection tool technology, the inspection contractor, the propulsion method, and the launch ' +
      'and receive facilities are not part of this assessment intake and are therefore not stated here. ' +
      'They are to be completed from the ILI run report before the document is issued. No figure below ' +
      'depends on them: every result is derived from the reported feature dimensions, the pipe ' +
      'specification, and the required pressure supplied with the data.',
  });
  if (usage) {
    blocks.push({
      kind: 'paragraph',
      text:
        `The line was commissioned in ${usage.commissioningYear} and was ` +
        `${usage.ageAtInspectionYears.toFixed(1)} years old at inspection, against an original design life ` +
        `of ${usage.designLifeYears} years` +
        (usage.designLifeRemainingYears < 0
          ? `. It is already ${Math.abs(usage.designLifeRemainingYears).toFixed(1)} years beyond that design life, and continued service past it is a management decision this assessment supports but does not make.`
          : `, leaving ${usage.designLifeRemainingYears.toFixed(1)} years of design life.`),
    });
  }

  // ── 1.1 Summary of results ────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '1.1  Summary of results' });
  blocks.push({
    kind: 'table',
    table: {
      caption: 'Table 1-1  Reported metal loss by section',
      columns: [
        { header: 'Section', align: 'left' },
        { header: 'Internal', align: 'right' },
        { header: 'External', align: 'right' },
        { header: 'Min depth [%WT]', align: 'right' },
        { header: 'Max depth [%WT]', align: 'right' },
        { header: 'Deepest at LD [m]', align: 'right' },
        { header: 'Surface', align: 'left' },
        { header: 'Orient.', align: 'center' },
      ],
      rows: [
        ...sections.map((row) => [
          row.section,
          row.internalCount.toLocaleString(),
          row.externalCount.toLocaleString(),
          row.minDepthPct.toFixed(1),
          row.maxDepthPct.toFixed(1),
          row.deepestFeature ? ldOf(row.deepestFeature) : '—',
          row.deepestFeature?.nominal.surface ?? '—',
          row.deepestFeature?.nominal.orient || '—',
        ]),
        [
          'Overall',
          internal.length.toLocaleString(),
          external.length.toLocaleString(),
          minDepthPct === null ? '—' : minDepthPct.toFixed(1),
          maxDepthPct === null ? '—' : maxDepthPct.toFixed(1),
          deepestOverall ? ldOf(deepestOverall) : '—',
          deepestOverall?.nominal.surface ?? '—',
          deepestOverall?.nominal.orient || '—',
        ],
      ],
    },
  });
  blocks.push({
    kind: 'list',
    items: [
      `Total internal metal-loss features: ${internal.length.toLocaleString()}.`,
      `Total external metal-loss features: ${external.length.toLocaleString()}.`,
      `Total assessed metal-loss features: ${items.length.toLocaleString()}.`,
      deepestInternal
        ? `Maximum reported internal metal loss: ${deepestInternal.nominal.maxDepthPct.toFixed(1)} %WT at ${whereIs(deepestInternal)}.`
        : 'Maximum reported internal metal loss: no internal feature was reported.',
      deepestExternal
        ? `Maximum reported external metal loss: ${deepestExternal.nominal.maxDepthPct.toFixed(1)} %WT at ${whereIs(deepestExternal)}.`
        : 'Maximum reported external metal loss: no external feature was reported.',
      deepestOverall
        ? `Deepest metal-loss feature overall: ${deepestOverall.nominal.maxDepthPct.toFixed(1)} %WT ` +
          `${String(deepestOverall.nominal.surface).toLowerCase()} at ${whereIs(deepestOverall)}.`
        : 'Deepest metal-loss feature overall: not established.',
      `Shallowest reported feature: ${minDepthPct === null ? 'not established' : `${minDepthPct.toFixed(1)} %WT`}. ` +
        'The vendor reporting threshold is not recorded in this intake, so no claim is made about metal ' +
        'loss below that depth.',
      `Features in the 4:00–8:00 bottom quadrant: ${items.filter((item) => item.bottomQuadrant).length.toLocaleString()}.`,
    ],
  });
  blocks.push({
    kind: 'paragraph',
    text:
      `As-inspected, ${reportCase.asInspected.populationCount.toLocaleString()} feature(s) were assessed. ` +
      (reportCase.asInspected.governingErf
        ? `The governing nominal ERF is ${num(reportCase.asInspected.governingErf.nominal.ERF)} at ` +
          `LD ${ldOf(reportCase.asInspected.governingErf)} m.`
        : 'No governing feature is available.'),
  });
  blocks.push({
    kind: 'paragraph',
    text:
      `As-managed, ${reportCase.asManaged.populationCount.toLocaleString()} active feature(s) remain after ` +
      `${reportCase.repairCounts.permanentVerified.toLocaleString()} verified permanent repair(s). ` +
      (reportCase.repairCounts.permanentPendingEvidence > 0
        ? `${reportCase.repairCounts.permanentPendingEvidence.toLocaleString()} permanent-repair label(s) remain active because identity, evidence, or chronology does not yet qualify for capacity credit. `
        : '') +
      `${reportCase.repairCounts.temporary.toLocaleString()} temporary repair(s) remain active and receive ` +
      'no capacity credit. Every figure from section 1.2 onwards is quoted on the as-managed population ' +
      'unless it is explicitly labelled as-inspected.',
  });

  // ── 1.2 Fitness for service ───────────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '1.2  Fitness for service' });

  // ── 1.2.1 Immediate integrity assessment ──────────────────────────
  blocks.push({ kind: 'heading', level: 3, text: '1.2.1  Immediate integrity assessment' });
  blocks.push({
    kind: 'paragraph',
    text:
      'The immediate integrity of the line was assessed in accordance with ASME B31G — Manual for ' +
      `Determining the Remaining Strength of Corroded Pipelines — using the ` +
      `${config.method === 'original' ? 'Original' : 'Modified'} method as a Level 1 evaluation ` +
      '(para. 1.6). Its acceptance criterion is that the calculated safe pressure is at least the required ' +
      'pressure, reported here as an estimated repair factor (ERF) below 1.0. ERF is an industry ' +
      'convention and is not a term defined by B31G. The full method, its assumptions, and the pipe ' +
      'specification each section was assessed on are in section 2.',
  });
  blocks.push({
    kind: 'list',
    items: [
      `Outside diameter, D: ${distinct(pipeSpec.map((row) => row.outerDiameterMm), 2, 'mm')}.`,
      `Nominal wall thickness, t: ${distinct(items.map((item) => item.nominal.wall), 2, 'mm')}.`,
      `Specified minimum yield strength, SMYS: ${distinct(pipeSpec.map((row) => row.smysMpa), 1, 'MPa')}.`,
      `Design factor, F: ${distinct(pipeSpec.map((row) => row.designFactor), 2, '')}.`,
      `Safety factor on the failure pressure, SF: ${distinct(pipeSpec.map((row) => row.safetyFactor), 2, '')}.`,
      `Required pressure (${pressureBasisLabel(config)}): ` +
        `${distinct(items.map((item) => item.nominal.p0), 3, 'MPa')} — ` +
        `${distinct(items.map((item) => item.nominal.p0 / MEGAPASCALS_PER_BAR), 2, 'barg')}.`,
      config.internalDesignPressureMpa != null && Number.isFinite(config.internalDesignPressureMpa)
        ? `Internal design pressure: ${config.internalDesignPressureMpa.toFixed(3)} MPa (${barg(config.internalDesignPressureMpa)} barg).`
        : 'Internal design pressure: not supplied. The ASME B31.4 design-thickness check therefore ' +
          'substitutes the required pressure, which makes the para. 451.6.2.2(b) no-repair band narrower ' +
          'than the design case would give.',
      `Maximum reported metal-loss depth: ${maxDepthPct === null ? 'not established' : `${maxDepthPct.toFixed(1)} %WT`}.`,
      `Maximum reported axial length: ${items.length ? `${maxOf(items.map((item) => item.nominal.length)).toFixed(1)} mm` : 'not established'}.`,
      `Assessment method: ${methodProfileLabel(config)}.`,
    ],
  });

  const lowest = summary.lowestSafePressure;
  const worstErf = summary.worstErf;
  const governing = worstErf?.item ?? lowest?.item ?? null;
  if (lowest) {
    const p0 = lowest.item.nominal.p0;
    const pSafe = lowest.item.nominal.safePressure;
    blocks.push({
      kind: 'formula',
      lines: [
        'P_safe ≥ P₀   ⟺   ERF ≤ 1',
        `P_safe,min = ${pSafe.toFixed(3)} MPa = ${barg(pSafe)} barg   at LD ${ldOf(lowest.item)} m`,
        `P₀ = ${p0.toFixed(3)} MPa = ${barg(p0)} barg   (${pressureBasisLabel(config)})`,
        `ΔP = P_safe,min − P₀ = ${(pSafe - p0).toFixed(3)} MPa = ${barg(pSafe - p0)} barg`,
        `SF_P = P_safe,min / P₀ = ${p0 > 0 ? (pSafe / p0).toFixed(3) : '—'}`,
        `ERF_max = ${num(worstErf?.item.nominal.ERF ?? null)}`,
      ],
      linesTex: [
        FFS_TEX.acceptance,
        `\\Psafe^{\\min} = ${pSafe.toFixed(3)}\\unit{MPa} = ${barg(pSafe)}\\unit{barg}\\cond{LD ${ldOf(lowest.item)} m}`,
        `\\Pop = ${p0.toFixed(3)}\\unit{MPa} = ${barg(p0)}\\unit{barg}`,
        `\\Delta P = \\Psafe^{\\min} - \\Pop = ${(pSafe - p0).toFixed(3)}\\unit{MPa} = ${barg(pSafe - p0)}\\unit{barg}`,
        `\\mathrm{SF}_{P} = \\frac{\\Psafe^{\\min}}{\\Pop} = ${p0 > 0 ? (pSafe / p0).toFixed(3) : '-'}`,
        `\\ERF_{\\max} = ${num(worstErf?.item.nominal.ERF ?? null)}`,
      ],
    });
  }

  blocks.push({
    kind: 'paragraph',
    text:
      summary.verdict === 'no-population'
        ? 'No feature was assessed, so no fitness-for-service statement is made.'
        : summary.verdict === 'fit-for-service'
          ? `No active feature reaches ERF 1.0 or ${screening.depthRejectionPct} %WT. On the as-reported ` +
            'dimensions the line is therefore FIT FOR SERVICE at the required pressure of ' +
            `${formatPressure(summary.pressureBasisMpa)}, subject to the assumptions and the data gaps ` +
            'recorded in this report.'
          : `${summary.failingCount.toLocaleString()} active feature(s) exceed the acceptance criteria at ` +
            `${formatPressure(summary.pressureBasisMpa)}. The line is NOT FIT FOR SERVICE at that pressure ` +
            'without pressure control, repair, or a Level 2 or Level 3 assessment of those locations.',
  });

  if (governing) {
    const n = governing.nominal;
    blocks.push({
      kind: 'table',
      table: {
        caption: 'Table 1-2  Governing feature — immediate integrity',
        columns: [
          { header: 'Parameter', align: 'left' },
          { header: 'Governing feature', align: 'left' },
        ],
        rows: [
          ['Log distance', `${ldOf(governing)} m`],
          ['Feature ID', n.featureId ?? 'not recorded'],
          ['Pipeline section', sectionOf(governing)],
          ['Corrosion location', n.surface],
          ['Depth', `${n.maxDepthPct.toFixed(1)} %WT`],
          ['Axial length', `${n.length.toFixed(1)} mm`],
          ['Orientation', n.orient || 'not recorded'],
          ['Nominal wall thickness', `${n.wall.toFixed(2)} mm`],
          ['Outside diameter', `${n.od.toFixed(2)} mm`],
          ['SMYS', `${n.smys.toFixed(1)} MPa`],
          ['Design factor / safety factor', `${n.df.toFixed(2)} / ${n.safetyFactor.toFixed(2)}`],
          ['Calculated failure pressure', `${n.Pf.toFixed(3)} MPa (${barg(n.Pf)} barg)`],
          [
            'Calculated safe working pressure',
            `${n.safePressure.toFixed(3)} MPa (${barg(n.safePressure)} barg)`,
          ],
          [
            'Required pressure',
            `${n.p0.toFixed(3)} MPa (${barg(n.p0)} barg) — ${pressureBasisLabel(config)}`,
          ],
          ['ERF (as reported)', num(n.ERF)],
          ['ERF (ILI tolerance screen)', num(governing.conservative.ERF)],
          [`ERF (after ${screening.forecastYears} y growth)`, num(governing.forecast.ERF)],
          ['Assessment result', n.acceptance === 'Acceptable' ? 'ACCEPTABLE' : 'NOT ACCEPTABLE'],
        ],
        criticalRows: n.acceptance === 'Acceptable' ? [] : [17],
      },
    });
  }

  // ── 1.2.2 Corrosion growth assessment ─────────────────────────────
  blocks.push({ kind: 'heading', level: 3, text: '1.2.2  Corrosion growth assessment' });
  blocks.push({
    kind: 'paragraph',
    text:
      'Corrosion growth is established per feature from the matched run pair where the run comparison ' +
      'produced one. The depth rate is the change in metal loss over the interval between the two ' +
      'surveys, and it is the rate the projection in 1.2.3 consumes.',
  });
  blocks.push({
    kind: 'formula',
    lines: [
      'CR_d [%WT/y] = (d₂ − d₁) / Δt',
      'CR_d [mm/y]  = (d₂ − d₁) · t / (100 · Δt)',
      'd₁, d₂ = metal-loss depth at the previous and current survey, %WT',
      't      = nominal wall thickness, mm',
      'Δt     = interval between the two surveys, years',
    ],
    linesTex: [
      '\\CRd^{\\%} = \\frac{d_{2} - d_{1}}{\\Delta t}\\cond{\\%WT per year}',
      '\\CRd = \\frac{\\left(d_{2} - d_{1}\\right)\\,t}{100\\,\\Delta t}\\cond{mm per year}',
      'd_{1},\\ d_{2} = \\text{depth at the previous and current survey}',
      't = \\text{nominal wall thickness}',
      '\\Delta t = \\text{interval between the two surveys}',
    ],
  });

  const intervals = buildGrowthIntervals(items);
  blocks.push({
    kind: 'table',
    table: {
      caption: 'Table 1-3  Inspection intervals and growth evidence by section',
      columns: [
        { header: 'Section', align: 'left' },
        { header: 'Previous survey', align: 'center' },
        { header: 'Current survey', align: 'center' },
        { header: 'Interval [y]', align: 'center' },
        { header: 'Matched pair', align: 'right' },
        { header: 'Derived rate', align: 'right' },
        { header: 'Max depth CGR [mm/y]', align: 'right' },
      ],
      rows: intervals.map((row) => [
        row.section,
        row.previousSurveys,
        row.currentSurveys,
        row.intervalYears,
        row.matchedCount.toLocaleString(),
        row.derivedCount.toLocaleString(),
        row.maxDepthRate === null ? 'None' : row.maxDepthRate.toFixed(3),
      ]),
    },
  });

  const activeInternal = active.filter(isInternal);
  const activeExternal = active.filter((item) => !isInternal(item));
  const fastestInternal = fastestDepthGrowthOf(activeInternal);
  const fastestExternal = fastestDepthGrowthOf(activeExternal);
  const meanInternal = meanDepthRate(activeInternal);
  const meanExternal = meanDepthRate(activeExternal);
  const evidence = summary.growthEvidenceBase;
  blocks.push({
    kind: 'list',
    items: [
      fastestInternal
        ? `Maximum internal corrosion growth rate: ${resolvedDepthRate(fastestInternal.nominal).toFixed(3)} mm/y at ${whereIs(fastestInternal)}.`
        : 'Maximum internal corrosion growth rate: no positive internal rate was established.',
      fastestExternal
        ? `Maximum external corrosion growth rate: ${resolvedDepthRate(fastestExternal.nominal).toFixed(3)} mm/y at ${whereIs(fastestExternal)}.`
        : 'Maximum external corrosion growth rate: no positive external rate was established.',
      meanInternal.mean === null
        ? 'Average internal corrosion growth rate: not established.'
        : `Average internal corrosion growth rate: ${meanInternal.mean.toFixed(3)} mm/y over ${meanInternal.count.toLocaleString()} feature(s) carrying a positive rate.`,
      meanExternal.mean === null
        ? 'Average external corrosion growth rate: not established.'
        : `Average external corrosion growth rate: ${meanExternal.mean.toFixed(3)} mm/y over ${meanExternal.count.toLocaleString()} feature(s) carrying a positive rate.`,
      summary.fastestDepthGrowth
        ? `Governing corrosion-growth feature: ${summary.fastestDepthGrowth.value} at ${summary.fastestDepthGrowth.location}.`
        : 'Governing corrosion-growth feature: not established.',
      `Growth evidence across the ${active.length.toLocaleString()} active feature(s): ` +
        `${evidence.measuredCount.toLocaleString()} carry a rate the source reported — a matched run pair, ` +
        'or a rate entered on the row — ' +
        `${evidence.zeroBaselineCount.toLocaleString()} a NEW-only zero-baseline estimate, ` +
        `${evidence.derivedCount.toLocaleString()} a rate the derivation ladder supplied, and ` +
        `${evidence.noneCount.toLocaleString()} no positive rate at all.`,
    ],
  });
  blocks.push({
    kind: 'paragraph',
    text:
      'Features the run comparison could not match are not reported as matched growth pairs. Where the ' +
      'screening configuration permits it they carry a derived rate — a service-age rate, or the ' +
      'percentile rate of their comparable population — and every figure quoted from such a feature is ' +
      'labelled a derivation, never a measurement. ' +
      (evidence.belowReviewThreshold > 0
        ? `Of the ${evidence.belowReviewThreshold.toLocaleString()} active feature(s) below the ` +
          `${evidence.reviewThresholdYears}-year review threshold, ` +
          `${evidence.belowReviewThresholdMeasured.toLocaleString()} rest on a measured rate.`
        : 'No active feature falls below the review threshold on the current rates.'),
  });

  // ── 1.2.3 Future integrity assessment ─────────────────────────────
  blocks.push({ kind: 'heading', level: 3, text: '1.2.3  Future integrity assessment' });
  blocks.push({
    kind: 'paragraph',
    text:
      'ASME B31G contains no remaining-life method: it evaluates remaining strength at the dimensions ' +
      'given to it. The projection below is therefore an operator procedure built on the code result. ' +
      'Each active feature is grown from its as-reported dimensions at its own rates, and the earlier of ' +
      `two limits governs — metal loss reaching ${screening.depthRejectionPct} %WT, which is the project ` +
      'rejection line, or the safe pressure falling to the required pressure, which is the code ' +
      'acceptance criterion. ' +
      (config.serviceLife?.designLifeYears == null
        ? 'No original design life was supplied, so no design-life cap is applied. '
        : usage !== null && usage.designLifeRemainingYears <= 0
          ? `The line is already past its ${config.serviceLife.designLifeYears}-year original design life, so no `
            + 'design-life cap is applied and the figures are corrosion-governed only; continued service is a '
            + 'life-extension decision outside this assessment. '
          : 'The reported figure is additionally capped at the design life still remaining at the inspection out '
            + `of the ${config.serviceLife.designLifeYears}-year original design life, so a feature whose own `
            + 'limit lies beyond it is reported at that remaining design life instead. ') +
      `Results are bounded to a ${horizonYears}-year analysis horizon.`,
  });
  blocks.push({
    kind: 'formula',
    lines: [
      'd(t) = d₀ + CR_d · t',
      'L(t) = L₀ + CR_L · t   (length held constant where no axial rate was established)',
      't_remnant = min(t_depth, t_ERF)',
      't_due = t_ILI + t_remnant',
    ],
    linesTex: [
      'd(t) = d_{0} + \\CRd\\,t',
      'L(t) = L_{0} + \\CRl\\,t\\cond{length held constant where no axial rate was established}',
      't_{\\text{remnant}} = \\min\\left(t_{\\text{depth}},\\ t_{\\ERF}\\right)',
      't_{\\text{due}} = t_{\\mathrm{ILI}} + t_{\\text{remnant}}',
    ],
  });

  const lifeGoverning = reportCase.remnantLife.governing;
  blocks.push({
    kind: 'paragraph',
    text:
      reportCase.remnantLife.years !== null
        ? 'The minimum predicted remaining life of the line is ' +
          `${reportCase.remnantLife.years.toFixed(2)} years after the inspection, reaching its limit on ` +
          `${reportCase.remnantLife.dueDateIso ?? 'a date that was not established'}. It is set by the ` +
          `feature at ${whereIs(lifeGoverning)}.`
        : 'No active feature establishes a limit that can be reported as a remaining life: ' +
          `${formatPipelineRemnantLife(reportCase.remnantLife, horizonYears)}. ` +
          `${reportCase.remnantLife.calculatedCount.toLocaleString()} feature(s) reached a limit inside the ` +
          `horizon, ${reportCase.remnantLife.notReachedCount.toLocaleString()} did not, and ` +
          `${reportCase.remnantLife.insufficientBasisCount.toLocaleString()} have no growth basis at all.`,
  });

  if (lifeGoverning) {
    const n = lifeGoverning.nominal;
    const life = n.remnantLife;
    blocks.push({
      kind: 'table',
      table: {
        caption: 'Table 1-4  Governing feature — remaining life',
        columns: [
          { header: 'Parameter', align: 'left' },
          { header: 'Governing feature', align: 'left' },
        ],
        rows: [
          ['Log distance', `${ldOf(lifeGoverning)} m`],
          ['Feature ID', n.featureId ?? 'not recorded'],
          ['Pipeline section', sectionOf(lifeGoverning)],
          ['Corrosion location', n.surface],
          ['Current depth', `${n.maxDepthPct.toFixed(1)} %WT of ${n.wall.toFixed(2)} mm wall`],
          ['Current axial length', `${n.length.toFixed(1)} mm`],
          ['Depth growth rate', `${life.depthRateMmPerYear.toFixed(3)} mm/y`],
          [
            'Length growth rate',
            life.lengthHeldConstant
              ? 'not established — length held constant'
              : `${life.lengthRateMmPerYear.toFixed(3)} mm/y`,
          ],
          [
            'Growth evidence',
            `${growthObservationLabel(n.growthEvidence?.depth.observation)} · ` +
              `${growthAnalysisBasisLabel(n.growthEvidence?.depth.analysisBasis)}`,
          ],
          [
            'Current safe working pressure',
            `${n.safePressure.toFixed(3)} MPa (${barg(n.safePressure)} barg)`,
          ],
          ['Remaining life', formatRemnantLife(life)],
          ['Governing limit', remnantLimitLabel(life)],
          ['Estimated limit date', life.dueDateIso ?? 'not established'],
        ],
        criticalRows: [10],
      },
    });
    blocks.push({
      kind: 'paragraph',
      text:
        'The working behind this figure — both limits, the design-life cap where one applied, and the ' +
        'state of the feature at its limit date — is in section 3.5.',
    });
  }

  blocks.push({
    kind: 'paragraph',
    text:
      'This prediction assumes the applied corrosion growth rate stays representative of future ' +
      'degradation. A change in operating conditions, fluid composition, inhibition performance, coating ' +
      'condition, cathodic protection, or any other active threat changes the actual rate, and the ' +
      'projection then has to be re-run against the next inspection rather than extrapolated further.',
  });

  // ── 1.2.4 Feature prioritisation ──────────────────────────────────
  blocks.push({ kind: 'heading', level: 3, text: '1.2.4  Feature prioritisation' });
  const banded = new Map<FfsExecutiveBand, FfsScreenedResult[]>(
    BAND_ORDER.map((band) => [band, [] as FfsScreenedResult[]]),
  );
  for (const item of active) banded.get(executiveBand(item))?.push(item);
  const bandCount = (band: FfsExecutiveBand) => (banded.get(band)?.length ?? 0).toLocaleString();
  blocks.push({
    kind: 'table',
    table: {
      caption: 'Table 1-5  Active features by priority band',
      columns: [
        { header: 'Priority', align: 'left' },
        { header: 'Criterion', align: 'left' },
        { header: 'Features', align: 'right' },
      ],
      rows: [
        [
          BAND_LABEL.immediate,
          'Calculated safe pressure at or below the required pressure on the as-reported dimensions (ERF ≥ 1.00)',
          bandCount('immediate'),
        ],
        [
          BAND_LABEL.high,
          `ERF reaches 1.00 under the ILI tolerance screen or the ${screening.forecastYears}-year forecast, ` +
            `depth at or above ${SEVERE_DEPTH_PCT} %WT, or tolerance-adjusted ERF at or above the ` +
            `${screening.reviewBandErf.toFixed(2)} review band`,
          bandCount('high'),
        ],
        [
          BAND_LABEL.medium,
          'Depth at or above 50 %WT, or a tolerance-adjusted remaining life below 10 years — active growth to be monitored',
          bandCount('medium'),
        ],
        [
          BAND_LABEL.low,
          'Adequate pressure margin and remaining life on both the as-reported and tolerance-adjusted cases',
          bandCount('low'),
        ],
      ],
      criticalRows: (banded.get('immediate')?.length ?? 0) > 0 ? [0] : [],
    },
  });

  const ranked = [...active].sort(
    (a, b) =>
      BAND_ORDER.indexOf(executiveBand(a)) - BAND_ORDER.indexOf(executiveBand(b)) ||
      b.conservative.ERF - a.conservative.ERF,
  );
  const rankedRows = ranked.slice(0, options.erfTableRows);
  if (rankedRows.length > 0) {
    blocks.push({
      kind: 'table',
      table: {
        caption: `Table 1-6  Highest ${rankedRows.length.toLocaleString()} active feature(s) by priority`,
        columns: [
          { header: 'Rank', align: 'right' },
          { header: 'LD [m]', align: 'right' },
          { header: 'Feature ID', align: 'left' },
          { header: 'Surface', align: 'left' },
          { header: 'Depth [%WT]', align: 'right' },
          { header: 'Length [mm]', align: 'right' },
          { header: 'ERF', align: 'right' },
          { header: 'P_safe [MPa]', align: 'right' },
          { header: 'Remaining life [y]', align: 'right' },
          { header: 'Priority', align: 'center' },
        ],
        rows: rankedRows.map((item, index) => [
          String(index + 1),
          ldOf(item),
          item.nominal.featureId ?? '—',
          item.nominal.surface,
          item.nominal.maxDepthPct.toFixed(1),
          item.nominal.length.toFixed(0),
          num(item.nominal.ERF),
          num(item.nominal.safePressure, 2),
          formatRemnantLife(item.nominal.remnantLife),
          BAND_LABEL[executiveBand(item)],
        ]),
        criticalRows: rankedRows
          .map((item, index) => (executiveBand(item) === 'immediate' ? index : -1))
          .filter((index) => index >= 0),
      },
    });
  }

  // ── 1.3 Risk assessment ───────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '1.3  Risk assessment' });
  blocks.push({
    kind: 'paragraph',
    text:
      'This assessment establishes no risk category, and none is stated here. A risk category is the ' +
      'product of a probability of failure and a consequence of failure, and consequence — product, ' +
      'inventory, location class, receptor sensitivity, and the operator’s own risk matrix — is not an ' +
      'input to a fitness-for-service calculation. The API 580 risk workspace consumes this assessment as ' +
      'its likelihood evidence, takes the consequence inputs from the operator, and is where the risk ' +
      'category and any risk-based interval are set.',
  });
  blocks.push({
    kind: 'list',
    items: [
      `Maximum ERF on the active population: ${num(worstErf?.item.nominal.ERF ?? null)}` +
        `${worstErf ? ` at ${worstErf.location}` : ''}.`,
      `Minimum remaining life: ${formatPipelineRemnantLife(reportCase.remnantLife, horizonYears)}` +
        `${lifeGoverning ? ` at ${whereIs(lifeGoverning)}` : ''}.`,
      summary.deepest
        ? `Deepest active feature: ${summary.deepest.value} at ${summary.deepest.location}.`
        : 'Deepest active feature: not established.',
      `Dominant reported mechanism: ${dominantMechanism} metal loss ` +
        `(${internal.length.toLocaleString()} internal, ${external.length.toLocaleString()} external).`,
      `Report readiness: ${reportCase.readiness.status.replace(/-/g, ' ')}, with ` +
        `${reportCase.readiness.findings.length.toLocaleString()} finding(s) listed in section 6.1.`,
    ],
  });

  // ── 1.4 Next in-line inspection ───────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '1.4  Next in-line inspection' });
  if (summary.nextInspectionByIso && reportCase.remnantLife.years !== null) {
    const remnantYears = reportCase.remnantLife.years;
    blocks.push({
      kind: 'formula',
      lines: [
        `t_next = t_remnant − ${NEXT_INSPECTION_MARGIN_YEARS} y = ${remnantYears.toFixed(2)} − ${NEXT_INSPECTION_MARGIN_YEARS} = ${(remnantYears - NEXT_INSPECTION_MARGIN_YEARS).toFixed(2)} y`,
        `date   = ${reportContext.inspectionDateIso} + t_next = ${summary.nextInspectionByIso}`,
      ],
      linesTex: [
        `t_{\\text{next}} = t_{\\text{remnant}} - ${NEXT_INSPECTION_MARGIN_YEARS}\\unit{y} = ` +
          `${remnantYears.toFixed(2)} - ${NEXT_INSPECTION_MARGIN_YEARS} = ` +
          `${(remnantYears - NEXT_INSPECTION_MARGIN_YEARS).toFixed(2)}\\unit{y}`,
        `t_{\\mathrm{ILI,next}} = \\text{${reportContext.inspectionDateIso}} + t_{\\text{next}} = ` +
          `\\text{${summary.nextInspectionByIso}}`,
      ],
    });
    blocks.push({
      kind: 'paragraph',
      text:
        `On this projection the next in-line inspection should be completed by ` +
        `${summary.nextInspectionByIso}, which is ${NEXT_INSPECTION_MARGIN_YEARS} years ahead of the ` +
        'projected limit date of the governing feature. This is a bound derived from the remaining-life ' +
        'projection, not a risk-based interval: the interval finally adopted is set in the risk ' +
        'assessment and against the applicable integrity-management requirement, and it must not fall ' +
        'later than the date above.',
    });
  } else if (summary.nextInspectionInsideMargin) {
    blocks.push({
      kind: 'paragraph',
      text:
        `The governing feature reaches its limit in ${formatPipelineRemnantLife(reportCase.remnantLife, horizonYears)}, ` +
        `which is inside the ${NEXT_INSPECTION_MARGIN_YEARS}-year deferral margin. No later inspection ` +
        'date can be derived from the projection: the disposition of that feature is an intervention ' +
        'decision rather than an inspection-scheduling one.',
    });
  } else {
    blocks.push({
      kind: 'paragraph',
      text:
        'No remaining life was established for the line, so no inspection date is derived from the ' +
        `projection: ${formatPipelineRemnantLife(reportCase.remnantLife, horizonYears)}. The next ` +
        'inspection interval must be set from the risk assessment and the applicable ' +
        'integrity-management requirement, and the growth basis re-established at the next run ' +
        'comparison.',
    });
  }

  // ── 1.5 Conclusion ────────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '1.5  Conclusion' });
  const worstSection = [...sections].sort((a, b) => b.maxDepthPct - a.maxDepthPct)[0] ?? null;
  blocks.push({
    kind: 'list',
    items: [
      `The inspection of ${config.lineName || 'the assessed pipeline'} on ${iliDateLabel} reported ` +
        `${items.length.toLocaleString()} metal-loss feature(s) between LD ${ldMin.toLocaleString()} m and ` +
        `LD ${ldMax.toLocaleString()} m — ${internal.length.toLocaleString()} internal and ` +
        `${external.length.toLocaleString()} external.`,
      deepestOverall
        ? `The deepest reported feature is ${deepestOverall.nominal.maxDepthPct.toFixed(1)} %WT ` +
          `${String(deepestOverall.nominal.surface).toLowerCase()} at ${whereIs(deepestOverall)}.`
        : 'No depth was established for the population.',
      summary.verdict === 'fit-for-service'
        ? `Assessed to ${methodProfileLabel(config)}, the line is FIT FOR SERVICE at ${formatPressure(summary.pressureBasisMpa)}.`
        : summary.verdict === 'not-fit-for-service'
          ? `Assessed to ${methodProfileLabel(config)}, ${summary.failingCount.toLocaleString()} active ` +
            `feature(s) fail the acceptance criteria at ${formatPressure(summary.pressureBasisMpa)}.`
          : 'No feature was assessed.',
      lowest
        ? `The minimum calculated safe working pressure is ${lowest.value} at ${lowest.location}, against ` +
          `a required pressure of ${formatPressure(lowest.item.nominal.p0)}.`
        : 'No safe working pressure was established.',
      worstErf
        ? `The governing pressure feature is at ${worstErf.location}, with an ERF of ${num(worstErf.item.nominal.ERF)}.`
        : 'No governing pressure feature was established.',
      summary.fastestDepthGrowth
        ? `The maximum calculated corrosion growth rate is ${summary.fastestDepthGrowth.value}, at ` +
          `${summary.fastestDepthGrowth.location}.`
        : 'No positive corrosion growth rate was established.',
      reportCase.remnantLife.years !== null
        ? `The predicted minimum remaining life is ${reportCase.remnantLife.years.toFixed(2)} years after ` +
          `the inspection, to approximately ${reportCase.remnantLife.dueDateIso}, governed by ` +
          `${whereIs(lifeGoverning)}.`
        : `No minimum remaining life is reported: ${formatPipelineRemnantLife(reportCase.remnantLife, horizonYears)}.`,
      'No risk category is established by this assessment; the category and any risk-based interval are ' +
        'set in the API 580 risk workspace.',
      summary.nextInspectionByIso
        ? `The next in-line inspection should be completed by ${summary.nextInspectionByIso}.`
        : 'No inspection date is derived from this projection.',
      `Continued integrity management should focus on ${dominantMechanism} corrosion` +
        `${worstSection ? `, particularly in the ${worstSection.section} section` : ''}.`,
    ],
  });

  // ── 1.6 Executive integrity status ────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '1.6  Executive integrity status' });
  // Stated as where the depth sits against the rejection line, not as a verdict.
  // "ACCEPTABLE" against a feature that fails on ERF two rows below is the one
  // reading this table must not produce: depth and remaining strength are
  // different criteria and can disagree.
  const depthStatus = (value: number | null): string => {
    if (value === null) return '—';
    if (value >= screening.depthRejectionPct) return `REJECT — at or above ${screening.depthRejectionPct} %WT`;
    if (value >= SEVERE_DEPTH_PCT) return `REVIEW — at or above ${SEVERE_DEPTH_PCT} %WT`;
    return `Below the ${screening.depthRejectionPct} %WT rejection line`;
  };
  const maxInternalDepth = deepestInternal?.nominal.maxDepthPct ?? null;
  const maxExternalDepth = deepestExternal?.nominal.maxDepthPct ?? null;
  const maxErfValue = worstErf?.item.nominal.ERF ?? null;
  const statusRows: string[][] = [
    ['Inspection date', reportContext.inspectionDateIso, '—'],
    ['Assessment method', methodProfileLabel(config), '—'],
    ['Total metal-loss features', items.length.toLocaleString(), '—'],
    ['Active features after repair credit', active.length.toLocaleString(), '—'],
    [
      'Maximum internal metal loss',
      maxInternalDepth === null ? 'None reported' : `${maxInternalDepth.toFixed(1)} %WT`,
      depthStatus(maxInternalDepth),
    ],
    [
      'Maximum external metal loss',
      maxExternalDepth === null ? 'None reported' : `${maxExternalDepth.toFixed(1)} %WT`,
      depthStatus(maxExternalDepth),
    ],
    [
      'Required pressure',
      `${formatPressure(summary.pressureBasisMpa)} — ${pressureBasisLabel(config)}`,
      '—',
    ],
    [
      'Minimum safe working pressure',
      lowest ? lowest.value : 'Not established',
      summary.verdict === 'fit-for-service' ? 'PASS' : summary.verdict === 'no-population' ? '—' : 'FAIL',
    ],
    [
      'Maximum ERF',
      num(maxErfValue),
      maxErfValue === null
        ? '—'
        : maxErfValue >= 1
          ? 'FAIL'
          : maxErfValue >= screening.reviewBandErf
            ? 'REVIEW'
            : 'PASS',
    ],
    [
      'Maximum depth corrosion growth rate',
      summary.fastestDepthGrowth ? summary.fastestDepthGrowth.value : 'Not established',
      evidence.measuredCount > 0
        ? `${evidence.measuredCount.toLocaleString()} measured`
        : 'No measured rate',
    ],
    [
      'Minimum remaining life',
      formatPipelineRemnantLife(reportCase.remnantLife, horizonYears),
      reportCase.remnantLife.years === null
        ? '—'
        : reportCase.remnantLife.years < config.highlightYears
          ? 'ACTION'
          : 'ACCEPTABLE',
    ],
    ['Estimated integrity limit', reportCase.remnantLife.dueDateIso ?? 'Not established', '—'],
    ['Risk category', 'Not established by this assessment', '—'],
    ['Next in-line inspection by', summary.nextInspectionByIso ?? 'Not derived', '—'],
    [
      'Report readiness',
      reportCase.readiness.status.replace(/-/g, ' '),
      reportCase.readiness.status === 'ready'
        ? 'PASS'
        : reportCase.readiness.status === 'blocked'
          ? 'BLOCKED'
          : 'REVIEW',
    ],
    [
      'Overall integrity status',
      summary.verdict === 'fit-for-service'
        ? 'FIT FOR SERVICE'
        : summary.verdict === 'not-fit-for-service'
          ? 'NOT FIT FOR SERVICE at the required pressure'
          : 'No population assessed',
      summary.verdict === 'fit-for-service' ? 'PASS' : summary.verdict === 'no-population' ? '—' : 'ACTION',
    ],
  ];
  blocks.push({
    kind: 'table',
    table: {
      caption: 'Table 1-7  Executive integrity status',
      columns: [
        { header: 'Integrity parameter', align: 'left' },
        { header: 'Result', align: 'left' },
        { header: 'Status', align: 'center' },
      ],
      rows: statusRows,
      criticalRows: summary.verdict === 'not-fit-for-service' ? [statusRows.length - 1] : [],
    },
  });

  // ── 1.7 Management statement ──────────────────────────────────────
  blocks.push({ kind: 'heading', level: 2, text: '1.7  Management statement' });
  blocks.push({
    kind: 'paragraph',
    text:
      summary.verdict === 'no-population'
        ? 'No feature was assessed, so no management statement is made.'
        : `On the inspection data supplied and the assessment performed, ${config.lineName || 'the assessed pipeline'} ` +
          `is considered ${summary.verdict === 'fit-for-service' ? 'FIT FOR SERVICE' : 'NOT FIT FOR SERVICE'} ` +
          `for operation at ${formatPressure(summary.pressureBasisMpa)}, subject to the ` +
          'integrity-management actions and the inspection date recorded above. This is a screening ' +
          'calculation: final disposition requires an approved procedure, verified input data, a ' +
          'competent technical authority, and independent checking.',
  });
  blocks.push({
    kind: 'paragraph',
    text:
      `The critical integrity driver is ${dominantMechanism} corrosion` +
      `${deepestOverall ? `, deepest at ${whereIs(deepestOverall)}` : ''}. The integrity-management ` +
      'strategy should therefore prioritise:',
  });
  blocks.push({
    kind: 'list',
    items: [
      governing
        ? `monitoring of the governing features named in this section — ${whereIs(governing)}` +
          `${lifeGoverning && lifeGoverning !== governing ? ` and ${whereIs(lifeGoverning)}` : ''};`
        : 'monitoring of the governing features, once one is established;',
      `control of the ${dominantMechanism} corrosion mechanism, verified against field evidence rather ` +
        'than against the ILI report alone;',
      `verification that the operating conditions match the ${pressureBasisLabel(config)} basis this ` +
        'assessment was run at;',
      'review of the corrosion-growth trend at the next run comparison, and re-running this projection ' +
        'on the measured rates it produces;',
      summary.nextInspectionByIso
        ? `completion of the next in-line inspection no later than ${summary.nextInspectionByIso};`
        : 'setting the next in-line inspection interval from the risk assessment, since this projection ' +
          'derives no date;',
      `closure of the ${reportCase.readiness.findings.length.toLocaleString()} report-readiness finding(s) ` +
        'listed in section 6.1 before this assessment is issued as a final disposition.',
    ],
  });

  return blocks;
}
