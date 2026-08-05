import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import {
  buildFfsReportCase,
  createFfsReportContext,
  formatLocalCalendarDate,
  type FfsReportContext,
} from '../src/lib/ffs/reportCase.ts';
import { buildNarrative } from '../src/lib/ffs/narrative.ts';
import { buildResultsWorkbook, resultsWorkbookFilename } from '../src/lib/ffs/exports.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Report case line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23'),
  highlightYears: 5,
  analysisHorizonYears: 30,
};

const reportContext: FfsReportContext = {
  inspectionDateIso: '2024-08-23',
  asOfDateIso: '2026-08-03',
  applicability: {
    materialClass: 'plain-carbon-low-alloy',
    operatingTemperatureC: 80,
    ductileFractureBehaviorConfirmed: true,
    pressureDominatedLoadingConfirmed: true,
    codeExclusionsReviewed: true,
    deepMetalLossMeasurementAccuracyConfirmed: true,
    effectiveCorrosionRateConfirmed: true,
    assessmentSafetyFactorBasis: 'MAOP and hydrotest basis',
    lowSafetyFactorJustification: '',
  },
};

test('report readiness fails closed when ASME applicability declarations are missing', () => {
  const items = assessed([row()]);
  const reportCase = buildFfsReportCase(items, createFfsReportContext(config, new Date('2026-08-03')));

  assert.equal(reportCase.readiness.status, 'blocked');
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'APPLICABILITY_NOT_CONFIRMED'));
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'SMYS69_QUALIFICATION_MISSING'));
});

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Feature ID': 'F-001',
    'LD [m]': '100',
    Section: 'Aerial',
    Surface: 'External',
    'Max Depth [%]': '40',
    'Length [mm]': '50',
    'Width [mm]': '80',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '1',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '390',
    'Operating Pressure P₀ [MPa]': '9.46',
    'Repair Status': 'Unrepaired',
    'Repair Method': '',
    'Repair Date': '',
    'Repair Reference': '',
    Recommendation: '',
    'Action Owner': '',
    ...overrides,
  };
}

function assessed(rows: Record<string, string>[]) {
  return screenResults(rows.map((item) => processRow(item, config)), config, DEFAULT_SCREENING_CONFIG);
}

test('verified permanent repair is retained as-inspected but removed from the as-managed population', () => {
  const items = assessed([
    row({
      'Feature ID': 'F-WORST',
      'Max Depth [%]': '75',
      'Repair Status': 'Permanent repair verified',
      'Repair Method': 'Cut and replace',
      'Repair Date': '2025-02-10',
      'Repair Reference': 'WO-19045794',
    }),
    row({ 'Feature ID': 'F-ACTIVE', 'LD [m]': '200', 'Max Depth [%]': '45' }),
  ]);

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.asInspected.populationCount, 2);
  assert.equal(reportCase.asInspected.governingErf?.nominal.featureId, 'F-WORST');
  assert.equal(reportCase.asManaged.populationCount, 1);
  assert.equal(reportCase.asManaged.governingErf?.nominal.featureId, 'F-ACTIVE');
  assert.equal(reportCase.repairCounts.permanentVerified, 1);
});

test('temporary repairs remain active in the managed scenario', () => {
  const items = assessed([
    row({
      'Feature ID': 'F-TEMP',
      'Repair Status': 'Temporary repair',
      'Repair Method': 'Composite wrap',
      'Repair Date': '2025-01-20',
      'Repair Reference': 'REP-17',
    }),
  ]);

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.asManaged.populationCount, 1);
  assert.equal(reportCase.repairCounts.temporary, 1);
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'TEMPORARY_REPAIR_ACTIVE'));
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'TEMPORARY_REPAIR_ACTION_INCOMPLETE'));
});

test('an unacceptable combined flaw blocks report readiness', () => {
  const items = assessed([
    row({
      'Feature ID': 'INT-1', 'LD [m]': '100.000', 'Max Depth [%]': '75',
      'Length [mm]': '180', 'Width [mm]': '80', 'Orient. (hrs:mins)': '6:00',
    }),
    row({
      'Feature ID': 'INT-2', 'LD [m]': '100.170', 'Max Depth [%]': '75',
      'Length [mm]': '180', 'Width [mm]': '80', 'Orient. (hrs:mins)': '6:00',
    }),
  ]);

  const reportCase = buildFfsReportCase(items, reportContext);
  assert.equal(reportCase.interactionAssessments.length, 1);
  assert.equal(reportCase.interactionAssessments[0].status, 'fail');
  assert.equal(reportCase.readiness.status, 'blocked');
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'COMBINED_FLAW_UNACCEPTABLE'));
});

test('report readiness is blocked when a verified repair has incomplete evidence', () => {
  const items = assessed([
    row({
      'Repair Status': 'Permanent repair verified',
      'Repair Method': '',
      'Repair Date': '',
      'Repair Reference': '',
    }),
  ]);

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.readiness.status, 'blocked');
  assert.equal(reportCase.asManaged.populationCount, 1);
  assert.equal(reportCase.repairCounts.permanentVerified, 0);
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'REPAIR_EVIDENCE_INCOMPLETE'));
});

test('report readiness distinguishes unavailable growth from a long service-life claim', () => {
  const items = assessed([
    row({ 'CR Depth [mm/y]': '0', 'CR Length [mm/y]': '0' }),
  ]);

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.asInspected.governingLife, null);
  assert.equal(reportCase.asInspected.lifeSummaryStatus, 'insufficient-growth-basis');
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'GROWTH_BASIS_UNAVAILABLE'));
  assert.equal(items[0].nominal.remnantLife.dueDateIso, null);
});

test('duplicate feature identity blocks an auditable report', () => {
  const items = assessed([
    row({ 'Feature ID': 'DUP-01', 'LD [m]': '100' }),
    row({ 'Feature ID': 'DUP-01', 'LD [m]': '200' }),
  ]);

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.readiness.status, 'blocked');
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'DUPLICATE_FEATURE_ID'));
});

test('an invalid repair calendar date stays active and blocks capacity credit', () => {
  const items = assessed([row({
    'Repair Status': 'Permanent repair verified',
    'Repair Method': 'Steel sleeve',
    'Repair Date': '2024-02-29',
    'Repair Reference': 'REP-VALID-BEFORE-MUTATION',
  })]);
  items[0].nominal.repairDate = '2025-02-29';

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.readiness.status, 'blocked');
  assert.equal(reportCase.asManaged.populationCount, 1);
  assert.equal(reportCase.repairCounts.permanentVerified, 0);
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'REPAIR_DATE_INVALID'));
});

test('a permanent repair completed before the ILI stays active and cannot receive capacity credit', () => {
  const items = assessed([row({
    'Repair Status': 'Permanent repair verified',
    'Repair Method': 'Cut and replace',
    'Repair Date': '2023-12-01',
    'Repair Reference': 'WO-OLD',
  })]);

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.asManaged.populationCount, 1);
  assert.equal(reportCase.repairCounts.permanentVerified, 0);
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'REPAIR_PREDATES_INSPECTION'));
});

test('whitespace-only repair evidence stays active after a UI-style override', () => {
  const items = assessed([row({
    'Repair Status': 'Permanent repair verified',
    'Repair Method': 'Cut and replace',
    'Repair Date': '2025-01-01',
    'Repair Reference': 'WO-1',
  })]);
  items[0].nominal.repairMethod = '   ';
  items[0].nominal.repairReference = '\t';

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.asManaged.populationCount, 1);
  assert.equal(reportCase.repairCounts.permanentVerified, 0);
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'REPAIR_EVIDENCE_INCOMPLETE'));
});

test('missing or duplicate identity prevents repair credit as well as final readiness', () => {
  const repair = {
    'Repair Status': 'Permanent repair verified',
    'Repair Method': 'Cut and replace',
    'Repair Date': '2025-01-01',
    'Repair Reference': 'WO-1',
  };
  const items = assessed([
    row({ ...repair, 'Feature ID': ' DUP-01 ', 'LD [m]': '100' }),
    row({ ...repair, 'Feature ID': 'dup-01', 'LD [m]': '200' }),
    row({ ...repair, 'Feature ID': '', 'LD [m]': '300' }),
  ]);

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.asManaged.populationCount, 3);
  assert.equal(reportCase.repairCounts.permanentVerified, 0);
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'FEATURE_ID_MISSING'));
  assert.ok(reportCase.readiness.findings.some((finding) => finding.code === 'DUPLICATE_FEATURE_ID'));
});

test('report as-of dates use the local calendar rather than a UTC date slice', () => {
  const localDate = new Date(2026, 7, 3, 0, 30, 0);
  assert.equal(formatLocalCalendarDate(localDate), '2026-08-03');
});

test('the report narrative states inspected and managed scenarios and carries the repair evidence register', () => {
  const items = assessed([
    row({
      'Feature ID': 'F-REPAIRED',
      'Repair Status': 'Permanent repair verified',
      'Repair Method': 'Cut and replace',
      'Repair Date': '2025-02-10',
      'Repair Reference': 'WO-42',
    }),
    row({ 'Feature ID': 'F-ACTIVE', 'LD [m]': '200' }),
  ]);

  const blocks = buildNarrative(items, config, DEFAULT_SCREENING_CONFIG, undefined, reportContext);
  const text = JSON.stringify(blocks);

  assert.match(text, /As-inspected/i);
  assert.match(text, /As-managed/i);
  assert.match(text, /Repair disposition register/i);
  assert.doesNotMatch(text, /RBI|risk based inspection/i);
});

test('narrative recommendations are based on active as-managed features, not repaired history', () => {
  const items = assessed([
    row({
      'Feature ID': 'F-REPAIRED-FAIL',
      'Max Depth [%]': '78',
      'Length [mm]': '400',
      'Repair Status': 'Permanent repair verified',
      'Repair Method': 'Cut and replace',
      'Repair Date': '2025-02-10',
      'Repair Reference': 'WO-FAIL-CLOSED',
    }),
    row({ 'Feature ID': 'F-ACTIVE-PASS', 'LD [m]': '200', 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0' }),
  ]);

  const blocks = buildNarrative(items, config, DEFAULT_SCREENING_CONFIG, undefined, reportContext);
  const recommendationLists = blocks.filter((block) => block.kind === 'list');
  const conclusions = recommendationLists[recommendationLists.length - 1];

  assert.ok(conclusions && conclusions.kind === 'list');
  assert.match(conclusions.items[0], /No active feature exceeds/i);
});

test('the Excel report carries scenarios, repair evidence, and readiness findings', () => {
  const items = assessed([
    row({
      'Feature ID': 'F-REPAIRED',
      'Repair Status': 'Permanent repair verified',
      'Repair Method': 'Cut and replace',
      'Repair Date': '2025-02-10',
      'Repair Reference': 'WO-42',
      'Action Owner': 'Integrity',
    }),
    row({ 'Feature ID': 'F-ACTIVE', 'LD [m]': '200' }),
  ]);

  const workbook = buildResultsWorkbook(items, config, DEFAULT_SCREENING_CONFIG, [], reportContext);

  assert.deepEqual(
    workbook.SheetNames.slice(0, 6),
    ['Parameters', 'Scenarios', 'Assessment', 'Repair register', 'Sections', 'Readiness'],
  );
  const scenarioRows = workbook.Sheets.Scenarios;
  assert.equal(scenarioRows.B4?.v, 'As-inspected');
  assert.equal(scenarioRows.B5?.v, 'As-managed');
  assert.equal(workbook.Sheets['Repair register'].A2?.v, 'F-REPAIRED');
  assert.match(String(workbook.Sheets.Readiness.B1?.v), /Ready/i);
});

test('Excel scenarios state why life is unavailable and blocked filenames are visibly draft', () => {
  const items = assessed([row({
    'Feature ID': '',
    'CR Depth [mm/y]': '0',
    'CR Length [mm/y]': '0',
  })]);
  const workbook = buildResultsWorkbook(items, config, DEFAULT_SCREENING_CONFIG, [], reportContext);
  const reportCase = buildFfsReportCase(items, reportContext);

  assert.match(String(workbook.Sheets.Scenarios.J4?.v), /growth basis unavailable/i);
  assert.match(resultsWorkbookFilename(config, reportCase.readiness.status), /DRAFT/i);
});

test('report readiness discloses NEW-only zero-baseline growth as an estimate', () => {
  const nominal = processRow(row(), config);
  nominal.growthEvidence = {
    oldSurveyYear: 2020,
    newSurveyYear: 2024,
    intervalYears: 4,
    depth: {
      observation: 'new-only-zero-baseline-estimate',
      analysisBasis: 'estimated',
      rawRateMmPerYear: null,
      analysisRateMmPerYear: nominal.crDepth,
      formula: '(40 / 100 x 9.3 mm - 0 mm) / 4 y',
      note: 'Zero-baseline estimate.',
    },
    length: nominal.growthEvidence!.length,
  };
  const items = screenResults([nominal], config, DEFAULT_SCREENING_CONFIG);
  const reportCase = buildFfsReportCase(items, reportContext);

  const finding = reportCase.readiness.findings.find((item) => item.code === 'NEW_ONLY_ZERO_BASELINE_ESTIMATE');
  assert.equal(finding?.severity, 'warning');
  assert.equal(finding?.affectedCount, 1);
});

test('the Word narrative caps a large repair register and points to the complete Excel appendix', () => {
  const items = assessed(Array.from({ length: 101 }, (_, index) => row({
    'Feature ID': `REP-${String(index + 1).padStart(3, '0')}`,
    'LD [m]': String(index + 1),
    'Repair Status': 'Temporary repair',
    'Repair Method': 'Engineered clamp',
    'Repair Date': '2025-01-01',
    'Repair Reference': `REF-${index + 1}`,
    Recommendation: 'Maintain under the approved temporary-repair plan',
    'Action Owner': 'Integrity',
  })));

  const blocks = buildNarrative(items, config, DEFAULT_SCREENING_CONFIG, undefined, reportContext);
  const repairTable = blocks.find(
    (block) => block.kind === 'table' && block.table.caption.includes('Repair disposition register'),
  );
  const text = JSON.stringify(blocks);

  assert.ok(repairTable && repairTable.kind === 'table');
  assert.equal(repairTable.table.rows.length, 100);
  assert.match(text, /complete repair register remains in the Excel assessment appendix/i);
});
