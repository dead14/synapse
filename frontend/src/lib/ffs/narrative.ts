import { formatLife } from './screening.ts';
import { isInternal } from './statistics.ts';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from './types.ts';
import { analysisHorizonYears, formatLifeProjection, lifeProjectionStatusLabel, lifeSortValue } from './lifeProjection.ts';

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
  | { kind: 'formula'; lines: string[] }
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

function methodName(config: FfsConfig): string {
  return config.method === 'original' ? 'Original ASME B31G' : 'Modified ASME B31G';
}

function flowStressText(config: FfsConfig): string {
  if (config.method === 'original') return '1.1 × SMYS';
  return config.modifiedSa === 'smys11' ? '1.1 × SMYS' : 'SMYS + 69 MPa';
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
  const belowThreshold = items.filter(
    (item) => item.nominal.expectedLife !== null && item.nominal.expectedLife < config.highlightYears,
  );
  const escalated = items.filter((item) => item.conservative.severity !== 'pass');
  const internalCount = items.filter(isInternal).length;
  const externalCount = total - internalCount;
  const bottomCount = items.filter((item) => item.bottomQuadrant).length;

  const byErf = [...items].sort((a, b) => b.nominal.ERF - a.nominal.ERF);
  const byLife = [...items].sort(
    (a, b) => lifeSortValue(a.nominal.expectedLife) - lifeSortValue(b.nominal.expectedLife),
  );
  const governing = byErf[0];
  const maxDepth = Math.max(...items.map((item) => item.nominal.maxDepthPct));
  const ldValues = items.map((item) => Number(item.nominal.ld)).filter(Number.isFinite);
  const ldMin = Math.min(...ldValues);
  const ldMax = Math.max(...ldValues);

  // ── 1.0 Introduction ──────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '1.0  Introduction' });
  blocks.push({
    kind: 'paragraph',
    text:
      `This report presents the fitness-for-service (FFS) assessment of ${total.toLocaleString()} metal-loss ` +
      `features reported for ${config.lineName || 'the assessed pipeline'}. The in-line inspection was ` +
      `carried out on ${config.iliDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. ` +
      `Features span log distance ${ldMin.toLocaleString()} m to ${ldMax.toLocaleString()} m, with a maximum ` +
      `reported depth of ${maxDepth.toFixed(1)}% of wall thickness.`,
  });
  blocks.push({
    kind: 'paragraph',
    text:
      `The remaining-strength evaluation follows the ${methodName(config)} method. Results are reported as an ` +
      `estimated repair factor (ERF), defined as the ratio of operating pressure to the calculated safe ` +
      `operating pressure. A feature is acceptable when ERF is below 1.0 and the reported depth is below ` +
      `${screening.depthRejectionPct}% of wall thickness.`,
  });

  // ── 2.0 Methodology ───────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '2.0  Assessment methodology' });
  blocks.push({
    kind: 'paragraph',
    text:
      `The ${methodName(config)} remaining-strength criterion was applied to each reported feature using the ` +
      `nominal geometry, material properties, and operating pressure supplied with the inspection data. ` +
      `The flow stress basis is ${flowStressText(config)}.`,
  });

  blocks.push({
    kind: 'formula',
    lines:
      config.method === 'original'
        ? [
            'z  = L² / (D · t)',
            'M  = √(1 + 0.8 z)                        for z ≤ 20',
            'Sf = S_flow · (1 − ⅔ d/t) / (1 − ⅔ (d/t)/M)   for z ≤ 20',
            'Sf = S_flow · (1 − d/t)                  for z > 20',
            'S_flow = 1.1 × SMYS',
            'P_f = 2 · Sf · t / D          P_safe = P_f × F',
            'ERF = S₀ / (Sf × F)           S₀ = P₀ · D / (2t)',
          ]
        : [
            'z  = L² / (D · t)',
            'M  = √(1 + 0.6275 z − 0.003375 z²)       for z ≤ 50',
            'M  = 0.032 z + 3.3                       for z > 50',
            `S_flow = ${flowStressText(config)}`,
            'Sf = S_flow · (1 − 0.85 d/t) / (1 − 0.85 (d/t)/M)',
            'P_f = 2 · Sf · t / D          P_safe = P_f × F',
            'ERF = S₀ / (Sf × F)           S₀ = P₀ · D / (2t)',
          ],
  });

  blocks.push({ kind: 'heading', level: 2, text: '2.1  Screening assumptions' });
  blocks.push({
    kind: 'list',
    items: [
      `ILI depth tolerance of +${screening.depthTolerancePct}% of wall thickness applied as an absolute addition for the conservative screen.`,
      `ILI length tolerance of +${screening.lengthToleranceMm} mm per end, giving a conservative length of reported + ${2 * screening.lengthToleranceMm} mm.`,
      screening.growthBasis === 'measured'
        ? `Each feature is grown radially at its own measured corrosion rate for the ${screening.forecastYears}-year forecast; features carrying no measured rate use ${screening.growthRateMmPerYear.toFixed(2)} mm/year.`
        : `A uniform corrosion growth rate of ${screening.growthRateMmPerYear.toFixed(2)} mm/year is applied radially to every feature for the ${screening.forecastYears}-year forecast.`,
      `Remaining-life calculations are bounded to a ${horizonYears}-year analysis horizon. A limit not reached inside that window is not reported as a service-life value or date.`,
      `Engineering review band starts at ERF ${screening.reviewBandErf.toFixed(2)}; ERF above 1.00 is reported as exceeding the calculated safe pressure.`,
      `Axial interaction screened at ${screening.interactionSpacingFactor}t edge-to-edge separation.`,
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
      `${belowThreshold.length.toLocaleString()} feature(s) have an expected remaining life below the ` +
      `${config.highlightYears}-year review threshold. Applying the ILI tolerance screen, ` +
      `${escalated.length.toLocaleString()} feature(s) fall at or above the ERF ` +
      `${screening.reviewBandErf.toFixed(2)} review band.`,
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

  blocks.push({ kind: 'heading', level: 2, text: '3.2  Features ranked by expected remaining life' });
  blocks.push({
    kind: 'table',
    table: {
      caption: `Table 3-2  Shortest ${Math.min(options.lifeTableRows, total)} features by expected remaining life`,
      columns: [
        { header: 'LD [m]', align: 'right' },
        { header: 'Section', align: 'left' },
        { header: 'Depth [%]', align: 'right' },
        { header: 'CR depth [mm/y]', align: 'right' },
        { header: 'Expected life [y]', align: 'right' },
        { header: 'Year of service limit', align: 'center' },
        { header: 'Failure criterion', align: 'left' },
        { header: 'Life to ERF 1', align: 'right' },
      ],
      rows: byLife.slice(0, options.lifeTableRows).map((item) => [
        Number(item.nominal.ld).toLocaleString(),
        item.nominal.section,
        item.nominal.maxDepthPct.toFixed(1),
        item.nominal.crDepth.toFixed(3),
        formatLifeProjection(item.nominal.expectedLife, item.nominal.lifeStatus, item.nominal.analysisHorizonYears),
        item.nominal.yearService ?? '—',
        lifeProjectionStatusLabel(item.nominal.lifeStatus, item.nominal.failureCriteria, item.nominal.analysisHorizonYears),
        formatLife(item.lifeToErf1, item.lifeToErf1Status, horizonYears),
      ]),
      criticalRows: byLife
        .slice(0, options.lifeTableRows)
        .map((item, i) => (
          item.nominal.expectedLife !== null && item.nominal.expectedLife < config.highlightYears ? i : -1
        ))
        .filter((i) => i >= 0),
    },
  });

  // ── 4.0 Figures ───────────────────────────────────────────────────
  blocks.push({ kind: 'heading', level: 1, text: '4.0  Figures' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-1  Depth category distribution by log distance', chartId: 'depth-by-ld' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-2  Feature orientation by log distance', chartId: 'orientation' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-3  Anomaly screening against the B31G Level 0 envelope', chartId: 'screening' });
  blocks.push({ kind: 'figure', caption: 'Figure 4-4  ERF against log distance', chartId: 'erf-ld' });

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
  if (unacceptable.length > 0) {
    recommendations.push(
      `${unacceptable.length.toLocaleString()} feature(s) exceed the acceptance criteria at the current ` +
        `operating pressure. Apply pressure control and raise an approved repair or a detailed ` +
        `(Level 2 or 3) assessment for these locations before continued operation at present conditions.`,
    );
  } else {
    recommendations.push(
      'No feature exceeds the acceptance criteria at the current operating pressure on the nominal ' +
        'calculation. Maintain existing integrity controls and the approved inspection plan.',
    );
  }
  if (belowThreshold.length > 0) {
    recommendations.push(
      `${belowThreshold.length.toLocaleString()} feature(s) have an expected remaining life below ` +
        `${config.highlightYears} years. Confirm the corrosion growth basis against matched prior ILI data and ` +
        `set reassessment or intervention dates accordingly.`,
    );
  }
  if (escalated.length > 0) {
    recommendations.push(
      `Verify the ILI tool performance specification for the ${escalated.length.toLocaleString()} feature(s) ` +
        `in the review band, since the disposition is sensitive to the assumed depth and length tolerance.`,
    );
  }
  if (maxDepth >= 70) {
    recommendations.push(
      `The deepest reported feature is at ${maxDepth.toFixed(1)}% of wall thickness. Validate depth and ` +
        `morphology by excavation or in-ditch NDE, and record coating, CP, and environmental condition at ` +
        `the same time.`,
    );
  }
  recommendations.push(
    'Resolve the open data gaps — tool performance specification, feature association to welds and dents, ' +
      'and an approved corrosion-rate basis — before this assessment is issued as a final disposition.',
  );

  blocks.push({ kind: 'list', items: recommendations });
  blocks.push({
    kind: 'paragraph',
    text:
      'This assessment is a screening calculation. Final fitness-for-service disposition requires an ' +
      'approved procedure, verified input data, a competent technical authority, and independent checking.',
  });

  return blocks;
}
