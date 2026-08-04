import * as XLSX from 'xlsx';
import type { DistributionTable, WorstRow } from './statistics.ts';
import type { NarrativeBlock } from './narrative.ts';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from './types.ts';
import type { AlignmentImportProvenance } from './alignmentImport.ts';
import { analysisHorizonYears, formatRemnantLife, remnantLimitLabel } from './lifeProjection.ts';
import { buildSectionDesignFactorSummary, buildSectionGrowthSummary } from './sectionSummary.ts';
import { designLifeUsage, EMPTY_SERVICE_LIFE } from './remnantLife.ts';
import {
  designFactorSourceLabel,
  engineeringDisposition,
  growthAnalysisBasisLabel,
  growthObservationLabel,
  methodProfileLabel,
  pressureBasisLabel,
} from './assessmentProfile.ts';
import {
  buildFfsReportCase,
  createFfsReportContext,
  type FfsReportCase,
  type FfsReportContext,
  type FfsScenarioSummary,
} from './reportCase.ts';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name: string): string {
  return (name || 'ffs-assessment').replace(/[^\w.-]+/g, '_').slice(0, 80);
}

function num(value: number | null, digits = 4): number | string {
  return value !== null && Number.isFinite(value) ? Number(value.toFixed(digits)) : '';
}

/**
 * Exports the full assessment: one row per feature with the nominal result, the
 * conservative screen, the forecast, and the derived engineering fields.
 */
function repairStatusLabel(status: FfsScreenedResult['nominal']['repairStatus']): string {
  if (status === 'permanent-repair-verified') return 'Permanent repair verified';
  if (status === 'temporary-repair') return 'Temporary repair';
  return 'Unrepaired';
}

function scenarioRow(id: string, label: string, scenario: FfsScenarioSummary): (string | number)[] {
  const erf = scenario.governingErf?.nominal;
  const life = scenario.governingLife?.nominal;
  return [
    id,
    label,
    scenario.populationCount,
    scenario.acceptableCount,
    scenario.unacceptableCount,
    erf?.featureId ?? '',
    erf?.ld ?? '',
    erf ? num(erf.ERF) : '',
    life?.featureId ?? '',
    life
      ? formatRemnantLife(life.remnantLife)
      : scenario.lifeSummaryStatus === 'insufficient-growth-basis'
        ? 'Not calculated - growth basis unavailable'
        : scenario.lifeSummaryStatus === 'not-reached-within-horizon'
          ? 'Limit not reached within analysis horizon'
          : scenario.lifeSummaryStatus === 'mixed-unbounded'
            ? 'Mixed: growth basis unavailable / limit not reached'
            : scenario.lifeSummaryStatus === 'empty'
              ? 'No active feature'
              : 'Not established',
    life?.remnantLife.dueDateIso ?? '',
    scenario.lifeStatusCounts.calculated,
    scenario.lifeStatusCounts['not-reached-within-horizon'],
    scenario.lifeStatusCounts['insufficient-growth-basis'],
  ];
}

/** Builds the auditable workbook without triggering a browser download. */
export function buildResultsWorkbook(
  items: FfsScreenedResult[],
  config: FfsConfig,
  screening: FfsScreeningConfig,
  provenance: AlignmentImportProvenance[] = [],
  reportContext: FfsReportContext = createFfsReportContext(config),
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const reportCase = buildFfsReportCase(items, reportContext);
  const readinessLabel = reportCase.readiness.status === 'blocked'
    ? 'Blocked'
    : reportCase.readiness.status === 'ready-with-warnings'
      ? 'Ready with warnings'
      : 'Ready';

  const parameters = [
    ['FFS assessment parameters'],
    [],
    ['Pipeline / line', config.lineName],
    ['Assessment method profile', methodProfileLabel(config)],
    ['Flow stress basis', config.method === 'original' ? '1.1 x SMYS' : config.modifiedSa === 'smys11' ? '1.1 x SMYS' : 'SMYS + 69 MPa'],
    ['ILI inspection date', config.iliDate.toISOString().split('T')[0]],
    ['Required pressure basis', pressureBasisLabel(config)],
    ['Remnant life review threshold [years]', config.highlightYears],
    ['Life analysis horizon [years]', analysisHorizonYears(config)],
    ['Original design life [years]', config.serviceLife?.designLifeYears ?? 'Not supplied'],
    ['Commissioning year', config.serviceLife?.commissioningYear ?? 'Not supplied'],
    [],
    ['Screening assumptions'],
    ['ILI depth tolerance [% WT]', screening.depthTolerancePct],
    ['ILI length tolerance [mm/end]', screening.lengthToleranceMm],
    ['Growth basis', screening.growthBasis === 'measured'
      ? 'Per-feature measured rate (configured rate used as the fallback)'
      : 'Uniform rate applied to every feature'],
    ['Corrosion growth rate [mm/y]', screening.growthRateMmPerYear],
    ['Forecast horizon [years]', screening.forecastYears],
    ['Review band ERF', screening.reviewBandErf],
    ['Interaction spacing factor [x t]', screening.interactionSpacingFactor],
    ['Depth rejection limit [% WT]', screening.depthRejectionPct],
    [],
    ['Total features assessed', items.length],
    ['As-managed active features', reportCase.asManaged.populationCount],
    ['Verified permanent repairs', reportCase.repairCounts.permanentVerified],
    ['Permanent repair labels pending capacity credit', reportCase.repairCounts.permanentPendingEvidence],
    ['Temporary repairs kept active', reportCase.repairCounts.temporary],
    ['Report readiness', readinessLabel],
    ['Report as-of date', reportContext.asOfDateIso],
    ['Generated', new Date().toISOString()],
    [],
    ['This is an engineering calculation record. Final disposition requires an approved procedure and independent checking.'],
    ['Risk ranking and next-inspection scheduling are outside this FFS report scope.'],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(parameters), 'Parameters');

  const scenarioHeader = [
    'Scenario ID', 'Scenario', 'Population', 'Acceptable', 'Not acceptable',
    'Governing ERF feature', 'Governing ERF LD [m]', 'Governing ERF',
    'Governing life feature', 'Governing life projection', 'Service limit date',
    'Calculated life count', 'Limit not reached count', 'Growth basis unavailable count',
  ];
  const scenarioSheet = XLSX.utils.aoa_to_sheet([
    ['FFS scenario comparison'],
    ['Capacity credit requires a unique feature ID and complete permanent-repair evidence dated from ILI through report as-of.'],
    scenarioHeader,
    scenarioRow('INSPECTED', 'As-inspected', reportCase.asInspected),
    scenarioRow('MANAGED', 'As-managed', reportCase.asManaged),
  ]);
  scenarioSheet['!cols'] = scenarioHeader.map((label) => ({ wch: Math.min(30, Math.max(12, label.length + 2)) }));
  scenarioSheet['!freeze'] = { xSplit: 0, ySplit: 3 };
  XLSX.utils.book_append_sheet(workbook, scenarioSheet, 'Scenarios');

  const header = [
    'Feature ID', 'LD [m]', 'Section', 'Surface', 'Orientation', 'Max depth [%]', 'Length [mm]', 'Width [mm]',
    'Wall [mm]', 'OD [mm]', 'SMYS [MPa]', 'Design factor', 'Design factor source', 'P0 [MPa]',
    'Clustered metal loss',
    'CR depth used [mm/y]', 'Depth growth observation', 'Depth analysis basis',
    'Raw depth growth [mm/y]', 'Growth interval [years]', 'Growth formula', 'Growth evidence note',
    'CR length used [mm/y]', 'Length growth observation', 'Length analysis basis', 'Length growth evidence note',
    'd [mm]', 'd/t', 'z', 'M', 'S_flow [MPa]', 'Sf [MPa]', 'Pf [MPa]', 'S0 [MPa]',
    'P_safe [MPa]', 'ERF nominal', 'Acceptance',
    'Remnant life [y]', 'Due date', 'Governing limit',
    'Years to 80% depth', 'Years to ERF 1', 'Length held constant', 'Capped at design life',
    'Conservative depth [%]', 'Conservative length [mm]', 'ERF conservative', 'P_safe conservative [MPa]',
    'Forecast depth [%]', 'ERF forecast',
    'Remnant life tolerance-adjusted [y]', 'Priority', 'Severity', 'Engineering disposition',
    'Clock hour', 'Bottom quadrant',
    'Repair status', 'Repair method', 'Repair date', 'Repair reference', 'Recommendation', 'Action owner',
  ];

  const rows = items.map((item) => {
    const n = item.nominal;
    const life = n.remnantLife;
    return [
      n.featureId ?? '', n.ld, n.section, n.surface, n.orient, num(n.maxDepthPct, 2), num(n.length, 2), num(n.width, 2),
      num(n.wall, 2), num(n.od, 2), num(n.smys, 2), num(n.df, 4), designFactorSourceLabel(n.designFactorSource),
      num(n.p0, 4),
      n.isClusteredMetalLoss ? 'Yes' : 'No',
      num(n.crDepth, 4), growthObservationLabel(n.growthEvidence?.depth.observation),
      growthAnalysisBasisLabel(n.growthEvidence?.depth.analysisBasis),
      num(n.growthEvidence?.depth.rawRateMmPerYear ?? null, 4),
      n.growthEvidence?.intervalYears ?? '', n.growthEvidence?.depth.formula ?? '',
      n.growthEvidence?.depth.note ?? '',
      // A length rate that was never established is written as text, not as a
      // zero. A zero in this column reads as "this defect is not lengthening",
      // which is a measurement nobody made.
      life.lengthHeldConstant ? 'Not calculated' : num(life.lengthRateMmPerYear, 4),
      growthObservationLabel(n.growthEvidence?.length.observation),
      growthAnalysisBasisLabel(n.growthEvidence?.length.analysisBasis),
      n.growthEvidence?.length.note ?? '',
      num(n.d), num(n.dt), num(n.z), n.M === null ? 'n/a' : num(n.M), num(n.sflow), num(n.Sf),
      num(n.Pf), num(n.So), num(n.safePressure), num(n.ERF), n.acceptance,
      formatRemnantLife(life), life.dueDateIso ?? '', remnantLimitLabel(life),
      life.depthLimitYears === null ? '' : num(life.depthLimitYears, 2),
      life.erfLimitYears === null ? '' : num(life.erfLimitYears, 2),
      life.lengthHeldConstant ? 'Yes' : 'No',
      life.designLifeCapApplied ? 'Yes' : 'No',
      num(item.conservative.depthPct, 2), num(item.conservative.lengthMm, 2),
      num(item.conservative.ERF), num(item.conservative.safePressure),
      num(item.forecast.depthPct, 2), num(item.forecast.ERF),
      formatRemnantLife(item.remnantLifeConservative),
      item.priority, item.conservative.severity, engineeringDisposition(item),
      item.clockHour === null ? '' : num(item.clockHour, 2),
      item.bottomQuadrant ? 'Yes' : 'No',
      repairStatusLabel(n.repairStatus), n.repairMethod ?? '', n.repairDate ?? '', n.repairReference ?? '',
      n.recommendation ?? '', n.actionOwner ?? '',
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet['!cols'] = header.map((label) => ({ wch: Math.min(22, Math.max(10, label.length + 2)) }));
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Assessment');

  const repairHeader = [
    'Feature ID', 'LD [m]', 'Status', 'Method', 'Completion date',
    'Evidence reference', 'Recommendation', 'Action owner', 'Managed scenario treatment',
  ];
  const repairRows = items
    .filter((item) => item.nominal.repairStatus !== 'unrepaired')
    .map((item) => {
      const n = item.nominal;
      return [
        n.featureId ?? '', n.ld, repairStatusLabel(n.repairStatus), n.repairMethod ?? '',
        n.repairDate ?? '', n.repairReference ?? '', n.recommendation ?? '', n.actionOwner ?? '',
        reportCase.repairCreditDecisions.get(item)?.credited
          ? 'Excluded after evidence validation'
          : 'Remains active; no capacity credit',
      ];
    });
  const repairSheet = XLSX.utils.aoa_to_sheet([repairHeader, ...repairRows]);
  repairSheet['!cols'] = repairHeader.map((label) => ({ wch: Math.min(34, Math.max(12, label.length + 2)) }));
  repairSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, repairSheet, 'Repair register');

  // Section roll-ups: the design factor each stretch was assessed with, and the
  // growth that stretch is actually experiencing. Both are read section-first in
  // a report, so they get a sheet rather than being buried in the row export.
  const designFactorHeader = [
    'Section', 'From [m]', 'To [m]', 'Features', 'Design factor', 'Source',
  ];
  const designFactorRows = buildSectionDesignFactorSummary(items).map((row) => [
    row.section, num(row.startLd, 3), num(row.endLd, 3), row.featureCount,
    num(row.designFactor, 4), designFactorSourceLabel(row.source),
  ]);

  const growthHeader = [
    'Section', 'Features', 'Internal', 'External',
    'Max INT depth CGR [mm/y]', 'Max EXT depth CGR [mm/y]',
    'Max INT length CGR [mm/y]', 'Max EXT length CGR [mm/y]',
    'Length CGR not established', 'Max depth [%WT]', 'Min P_safe [MPa]',
    'Shortest remnant life [y]', 'Shortest remnant life feature',
  ];
  const growthRows = buildSectionGrowthSummary(items).map((row) => [
    row.section, row.featureCount, row.internalCount, row.externalCount,
    num(row.internalDepthRateMmPerYear, 4), num(row.externalDepthRateMmPerYear, 4),
    num(row.internalLengthRateMmPerYear, 4), num(row.externalLengthRateMmPerYear, 4),
    row.lengthRateUnavailableCount, num(row.maxDepthPct, 2), num(row.minSafePressureMpa, 3),
    num(row.shortestRemnantLifeYears, 2),
    row.shortestRemnantLifeFeature?.nominal.featureId ?? '',
  ]);

  const usage = designLifeUsage(config.serviceLife ?? EMPTY_SERVICE_LIFE, config.iliDate);
  const sectionSheet = XLSX.utils.aoa_to_sheet([
    ['Design factor by section'],
    designFactorHeader,
    ...designFactorRows,
    [],
    ['Maximum corrosion growth by section'],
    ['Reported as the section maximum, not a mean: an average hides the local rate this table exists to expose.'],
    ['A length rate that was never established is counted as unavailable, never as a zero.'],
    growthHeader,
    ...growthRows,
    [],
    ['Line remnant life'],
    ['As-managed remnant life [y]', num(reportCase.remnantLife.years, 2)],
    ['As-managed due date', reportCase.remnantLife.dueDateIso ?? ''],
    ['Governing feature', reportCase.remnantLife.governing?.nominal.featureId ?? ''],
    ['Governing feature LD [m]', reportCase.remnantLife.governing?.nominal.ld ?? ''],
    ['Features recommended for permanent repair', reportCase.repairProgrammeTargets.length],
    ['Remnant life after that repair programme [y]', num(reportCase.remnantLifeAfterRepairProgramme.years, 2)],
    ['Due date after that repair programme', reportCase.remnantLifeAfterRepairProgramme.dueDateIso ?? ''],
    ['Original design life [years]', config.serviceLife?.designLifeYears ?? 'Not supplied'],
    ['Commissioning year', config.serviceLife?.commissioningYear ?? 'Not supplied'],
    ['Age at inspection [years]', usage ? num(usage.ageAtInspectionYears, 2) : 'Not calculable'],
    ['Design life remaining at inspection [years]', usage ? num(usage.designLifeRemainingYears, 2) : 'Not calculable'],
  ]);
  sectionSheet['!cols'] = growthHeader.map((label) => ({ wch: Math.min(30, Math.max(14, label.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, sectionSheet, 'Sections');

  const readinessHeader = ['Severity', 'Code', 'Affected features', 'Finding'];
  const readinessRows = reportCase.readiness.findings.map((finding) => [
    finding.severity.toUpperCase(), finding.code, finding.affectedCount, finding.message,
  ]);
  const readinessSheet = XLSX.utils.aoa_to_sheet([
    ['Report readiness', readinessLabel],
    readinessHeader,
    ...readinessRows,
  ]);
  readinessSheet['!cols'] = [{ wch: 18 }, { wch: 38 }, { wch: 20 }, { wch: 90 }];
  readinessSheet['!freeze'] = { xSplit: 0, ySplit: 2 };
  XLSX.utils.book_append_sheet(workbook, readinessSheet, 'Readiness');

  // The dataset the engine actually consumed, with the Corrosion Analysis
  // decision that released each feature. This is the auditable record of what
  // went in — the assessment sheet only shows what came out.
  if (provenance.length > 0) {
    const sourceHeader = [
      'Feature ID', 'Alignment source key', 'Alignment session', 'Selection reason',
      'LD [m]', 'Section', 'Surface', 'Orientation', 'Max depth [%WT]', 'Length [mm]',
      'Width [mm]', 'Nominal wall thickness [mm]', 'CR depth used [mm/y]', 'CR length used [mm/y]',
      'OLD survey year', 'NEW survey year', 'Interval [years]', 'Depth growth observation',
      'Depth analysis basis', 'Raw depth growth [mm/y]', 'Depth growth formula', 'Depth growth note',
    ];
    const sourceRows = items.map((item) => {
      const n = item.nominal;
      const record = provenance[item.index];
      return [
        record?.featureId ?? '', record?.sourceFeatureKey ?? '', record?.alignmentSessionId ?? '',
        record?.selectionReason ?? '',
        n.ld, n.section, n.surface, n.orient, num(n.maxDepthPct, 2), num(n.length, 2),
        num(n.width, 2), num(n.wall, 2), num(n.crDepth, 4), num(n.crLength, 4),
        record?.growthEvidence.oldSurveyYear ?? '', record?.growthEvidence.newSurveyYear ?? '',
        record?.growthEvidence.intervalYears ?? '',
        growthObservationLabel(record?.growthEvidence.depth.observation),
        growthAnalysisBasisLabel(record?.growthEvidence.depth.analysisBasis),
        num(record?.growthEvidence.depth.rawRateMmPerYear ?? null, 4),
        record?.growthEvidence.depth.formula ?? '', record?.growthEvidence.depth.note ?? '',
      ];
    });
    const sourceSheet = XLSX.utils.aoa_to_sheet([sourceHeader, ...sourceRows]);
    sourceSheet['!cols'] = sourceHeader.map((label) => ({ wch: Math.min(26, Math.max(12, label.length + 2)) }));
    sourceSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(workbook, sourceSheet, 'Source data');
  }

  return workbook;
}

export function exportResultsWorkbook(
  items: FfsScreenedResult[],
  config: FfsConfig,
  screening: FfsScreeningConfig,
  provenance: AlignmentImportProvenance[] = [],
  reportContext: FfsReportContext = createFfsReportContext(config),
): void {
  const workbook = buildResultsWorkbook(items, config, screening, provenance, reportContext);
  const reportCase = buildFfsReportCase(items, reportContext);

  const blob = new Blob([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, resultsWorkbookFilename(config, reportCase.readiness.status));
}

export function resultsWorkbookFilename(
  config: FfsConfig,
  readinessStatus: FfsReportCase['readiness']['status'],
): string {
  const draft = readinessStatus === 'blocked' ? 'DRAFT_' : '';
  return `${safeFilename(config.lineName)}_FFS_${draft}assessment.xlsx`;
}

/** Exports the two statistics tables as separate sheets. */
export function exportStatisticsWorkbook(
  distribution: DistributionTable,
  worstRows: WorstRow[],
  binSizeM: number,
  config: FfsConfig,
): void {
  const workbook = XLSX.utils.book_new();

  const distHeader = ['LD bin [m]'];
  for (const bucket of distribution.buckets) {
    distHeader.push(`${bucket.name} int`, `${bucket.name} ext`, `${bucket.name} total`);
  }
  distHeader.push('Row total');

  const distRows = distribution.rows.map((row) => {
    const cells: (string | number)[] = [row.bin.label];
    for (const cell of row.cells) cells.push(cell.internal, cell.external, cell.total);
    cells.push(row.total);
    return cells;
  });

  const totalsRow: (string | number)[] = ['Total'];
  for (const cell of distribution.totals.cells) {
    totalsRow.push(cell.internal, cell.external, cell.total);
  }
  totalsRow.push(distribution.totals.total);

  const distSheet = XLSX.utils.aoa_to_sheet([
    [`Defect distribution — ${binSizeM} m log-distance bins`],
    [],
    distHeader,
    ...distRows,
    totalsRow,
  ]);
  XLSX.utils.book_append_sheet(workbook, distSheet, 'Distribution');

  const worstHeader = [
    'LD bin [m]', 'Features in bin', 'LD [m]', 'Section', 'Surface',
    'Depth [%]', 'Length [mm]', 'ERF', 'Conservative ERF', 'Remnant life',
    'Remnant life tolerance-adjusted', 'Priority', 'Acceptance',
  ];
  const worstBody = worstRows
    .filter((row) => row.worst !== null)
    .map((row) => {
      const item = row.worst!;
      const n = item.nominal;
      return [
        row.bin.label, row.count, n.ld, n.section, n.surface,
        num(n.maxDepthPct, 2), num(n.length, 2), num(n.ERF), num(item.conservative.ERF),
        formatRemnantLife(n.remnantLife),
        formatRemnantLife(item.remnantLifeConservative),
        item.priority, n.acceptance,
      ];
    });

  const worstSheet = XLSX.utils.aoa_to_sheet([
    [`Worst feature per ${binSizeM} m log-distance bin`],
    [],
    worstHeader,
    ...worstBody,
  ]);
  XLSX.utils.book_append_sheet(workbook, worstSheet, 'Worst per bin');

  const blob = new Blob([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `${safeFilename(config.lineName)}_FFS_statistics.xlsx`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Exports the narrative as a Word-readable document. Word opens HTML with an
 * .doc extension and honours the inline styles, which keeps the export
 * dependency-free while preserving headings, tables, and captions.
 */
export function exportNarrativeDoc(
  blocks: NarrativeBlock[],
  config: FfsConfig,
  chartImages: Record<string, string> = {},
  documentStatus: 'ready' | 'ready-with-warnings' | 'blocked' = 'ready',
): void {
  const body: string[] = [];
  const statusLabel = documentStatus === 'blocked'
    ? 'DRAFT — REPORT READINESS BLOCKED'
    : documentStatus === 'ready-with-warnings'
      ? 'READY WITH WARNINGS — ENGINEERING ACKNOWLEDGEMENT REQUIRED'
      : 'REPORT READINESS CHECKS COMPLETE';

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const size = block.level === 1 ? 16 : block.level === 2 ? 13 : 11.5;
        const color = block.level === 1 ? '#0f2745' : block.level === 2 ? '#1c3d63' : '#2f5b8a';
        const border = block.level === 1 ? 'border-bottom:1.5pt solid #1463ff;padding-bottom:4pt;' : '';
        body.push(
          `<h${block.level} style="font-family:Calibri,sans-serif;font-size:${size}pt;color:${color};` +
            `margin:16pt 0 6pt;${border}">${escapeHtml(block.text)}</h${block.level}>`,
        );
        break;
      }
      case 'paragraph':
        body.push(
          `<p style="font-family:Calibri,sans-serif;font-size:11pt;line-height:1.5;text-align:justify;` +
            `margin:0 0 8pt;">${escapeHtml(block.text)}</p>`,
        );
        break;
      case 'list':
        body.push(
          `<ul style="font-family:Calibri,sans-serif;font-size:11pt;line-height:1.45;margin:0 0 10pt;">` +
            block.items.map((item) => `<li style="margin-bottom:4pt;">${escapeHtml(item)}</li>`).join('') +
            `</ul>`,
        );
        break;
      case 'formula':
        body.push(
          `<p style="font-family:Consolas,monospace;font-size:9.5pt;line-height:1.6;background:#f4f6fa;` +
            `border:0.75pt solid #d5dce6;padding:8pt 10pt;margin:0 0 10pt;white-space:pre;">` +
            block.lines.map(escapeHtml).join('<br/>') +
            `</p>`,
        );
        break;
      case 'table': {
        const head = block.table.columns
          .map(
            (col) =>
              `<th style="background:#e8eef7;border:0.5pt solid #b9c4d4;padding:4pt 6pt;font-size:9pt;` +
              `font-family:Calibri,sans-serif;text-align:${col.align ?? 'left'};">${escapeHtml(col.header)}</th>`,
          )
          .join('');
        const rows = block.table.rows
          .map((row, rowIndex) => {
            const critical = block.table.criticalRows?.includes(rowIndex);
            const bg = critical ? 'background:#fff4e5;font-weight:bold;' : rowIndex % 2 ? 'background:#f8fafc;' : '';
            const cells = row
              .map(
                (cell, cellIndex) =>
                  `<td style="border:0.5pt solid #d5dce6;padding:3.5pt 6pt;font-size:9pt;` +
                  `font-family:Calibri,sans-serif;text-align:${block.table.columns[cellIndex]?.align ?? 'left'};">` +
                  `${escapeHtml(cell)}</td>`,
              )
              .join('');
            return `<tr style="${bg}">${cells}</tr>`;
          })
          .join('');
        body.push(
          `<table style="border-collapse:collapse;width:100%;margin:0 0 4pt;">` +
            `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>` +
            `<p style="font-family:Calibri,sans-serif;font-size:9pt;font-style:italic;color:#5a6b80;` +
            `text-align:center;margin:0 0 12pt;">${escapeHtml(block.table.caption)}</p>`,
        );
        break;
      }
      case 'figure': {
        const image = chartImages[block.chartId];
        body.push(
          image
            ? `<p style="text-align:center;margin:0 0 4pt;"><img src="${image}" style="width:100%;max-width:620pt;"/></p>` +
                `<p style="font-family:Calibri,sans-serif;font-size:9pt;font-style:italic;color:#5a6b80;` +
                `text-align:center;margin:0 0 12pt;">${escapeHtml(block.caption)}</p>`
            : `<p style="font-family:Calibri,sans-serif;font-size:9.5pt;color:#8a6d3b;background:#fff8e8;` +
                `border:0.75pt dashed #d9b979;padding:10pt;text-align:center;margin:0 0 12pt;">` +
                `${escapeHtml(block.caption)} — generate charts before exporting to embed this figure.</p>`,
        );
        break;
      }
    }
  }

  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"/><title>${escapeHtml(config.lineName || 'FFS assessment')}</title>` +
    `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->` +
    `<style>@page{size:A4;margin:2cm;} body{font-family:Calibri,sans-serif;}</style></head>` +
    `<body>` +
    `<p style="font-family:Calibri,sans-serif;font-size:9pt;font-weight:bold;letter-spacing:0.8pt;` +
    `color:${documentStatus === 'blocked' ? '#a61b1b' : documentStatus === 'ready-with-warnings' ? '#8a5b00' : '#16794a'};` +
    `border:1pt solid currentColor;padding:6pt 8pt;text-align:center;margin:0 0 14pt;">` +
    `${escapeHtml(statusLabel)}</p>` +
    `<p style="font-family:Calibri,sans-serif;font-size:9pt;letter-spacing:1pt;color:#1463ff;` +
    `text-transform:uppercase;margin:0 0 2pt;">Fitness-for-service assessment</p>` +
    `<h1 style="font-family:Calibri,sans-serif;font-size:20pt;color:#0f2745;margin:0 0 4pt;">` +
    `${escapeHtml(config.lineName || 'Pipeline assessment')}</h1>` +
    `<p style="font-family:Calibri,sans-serif;font-size:10pt;color:#5a6b80;margin:0 0 18pt;` +
    `border-bottom:1pt solid #d5dce6;padding-bottom:10pt;">` +
    `${config.method === 'original' ? 'Original' : 'Modified'} ASME B31G · ` +
    `ILI ${config.iliDate.toLocaleDateString('en-GB')} · ` +
    `Generated ${new Date().toLocaleDateString('en-GB')}</p>` +
    body.join('\n') +
    `</body></html>`;

  triggerDownload(
    new Blob(['﻿', html], { type: 'application/msword' }),
    `${safeFilename(config.lineName)}_FFS_${documentStatus === 'blocked' ? 'DRAFT_' : ''}narrative.doc`,
  );
}

/** Downloads a Chart.js canvas as a PNG. */
export function downloadCanvasPng(canvas: HTMLCanvasElement | null, filename: string): void {
  if (!canvas) return;
  // Composite onto an opaque background so the PNG is readable in documents.
  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const ctx = output.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvas, 0, 0);
  output.toBlob((blob) => {
    if (blob) triggerDownload(blob, `${safeFilename(filename)}.png`);
  }, 'image/png');
}
