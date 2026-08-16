/**
 * The RBI screening workbook.
 *
 * Four sheets, because the assessment is four steps. The cover states what was
 * assessed and who signed it, the plan is the deliverable, the drivers let a
 * reviewer check any category against the number behind it, and the last sheet
 * says what the assessment does not cover — a risk report without its limits
 * reads as a clean bill of health for threats it never looked at.
 */

import * as XLSX from 'xlsx';

import { safeFilename, triggerDownload } from '../ffs/exports.ts';
import { MAX_INTERVAL_YEARS, RISK_ACCEPTANCE, RISK_MATRIX } from './api580.ts';
import { INTERVAL_BASIS_LABEL, THREATS } from './catalogues.ts';
import { readiness } from './record.ts';
import type { RbiAssessment } from './types.ts';

type Cell = string | number | null;

function sheetOf(rows: Cell[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows.map((row) => row.map((cell) => (cell === null ? '' : cell))));
}

/** A blank in a report should say it is blank, not look like a zero. */
function stated(value: string | number | null | undefined): Cell {
  if (value === null || value === undefined) return 'Not stated';
  if (typeof value === 'string') return value.trim() === '' ? 'Not stated' : value;
  return value;
}

export function exportRbiWorkbook(assessment: RbiAssessment): void {
  const { record } = assessment;
  const outstanding = readiness(record).filter((item) => !item.satisfied);
  const book = XLSX.utils.book_new();

  /* Cover */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Risk-based inspection screening'],
    ['Title', stated(record.title)],
    ['Line or segment', assessment.lineName],
    ['Practice', assessment.provenance.practice],
    ['Approach', assessment.provenance.approach],
    [],
    ['Derived from FFS session', stated(record.ffsSessionId)],
    ['Inspection date — intervals count from here', assessment.assessmentDateIso],
    ['Assessed features', assessment.totals.features],
    ['Anomalies with no B31G result', assessment.totals.unassessed],
    ['Sections assessed', assessment.sections.length],
    ['Earliest inspection due', stated(assessment.totals.nextDueIso)],
    [],
    ['Fluid', record.fluid.replace(/-/g, ' ')],
    ['Toxic release credible', record.toxic ? 'Yes' : 'No'],
    ['Population exposure — line default', record.population],
    ['Environmental receptor — line default', record.environment.replace(/-/g, ' ')],
    ['Business impact', record.businessImpact],
    ['Regulatory maximum interval [y]', stated(record.maxIntervalYears)],
    [],
    ['Sections by risk level'],
    ...Object.entries(assessment.totals.byLevel).map(([level, total]) => [level, total]),
    ['At unacceptable risk', assessment.totals.unacceptable],
    [],
    ['Assessed by', stated(record.assessedBy), stated(record.assessedOnIso)],
    ['Notes', stated(record.notes)],
    ...(outstanding.length > 0
      ? [[], ['DRAFT — outstanding before issue'], ...outstanding.map((item) => [item.requirement])]
      : []),
  ]), 'Assessment');

  /* The deliverable */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Inspection plan by section'],
    [],
    [
      'Section', 'From [m]', 'To [m]', 'Assessed features', 'Unassessed anomalies',
      'Probability', 'Consequence', 'Risk level', 'Acceptance',
      'Interval [y]', 'Interval basis', 'Next inspection',
      'Governing threat', 'Governing feature', 'Governing LD [m]', 'Governing ERF',
      'Governing remaining life [y]', 'Growth rate assumed', 'Consequence overridden',
      'Recommendation',
    ],
    ...assessment.sections.map((section) => [
      section.label,
      section.fromM,
      section.toM,
      section.featureCount,
      section.probability.unassessedCount,
      section.probability.category,
      section.consequence.category,
      section.riskLevel,
      section.acceptance,
      section.inspection.intervalYears,
      INTERVAL_BASIS_LABEL[section.inspection.basis],
      section.inspection.dueDateIso,
      stated(section.probability.governingThreat),
      section.governingFeature?.featureId ?? '',
      section.governingFeature?.ldM ?? null,
      section.governingFeature?.erf ?? null,
      section.governingFeature?.remnantLifeYears ?? null,
      section.probability.growthAssumed ? 'Yes' : 'No',
      section.consequence.overridden ? 'Yes' : 'No',
      section.inspection.recommendation,
    ]),
    [],
    ['Section consequence overrides'],
    ['Section', 'Population', 'Environmental receptor', 'Reason'],
    ...record.overrides.map((row) => [
      row.sectionId,
      stated(row.population),
      stated(row.environment),
      stated(row.note),
    ]),
    ...(record.overrides.length === 0
      ? [['No overrides; the line default applies throughout.']]
      : []),
  ]), 'Inspection plan');

  /* Every number behind every category */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Threat review'],
    ['Threat', 'Group', 'Relevance', 'Inspection coverage', 'Detected by', 'Note'],
    ...THREATS.map((definition) => {
      const threat = record.threats.find((item) => item.id === definition.id);
      return [
        definition.label,
        definition.group.replace(/-/g, ' '),
        stated(threat?.relevance),
        definition.measured ? 'Measured by the in-line inspection' : stated(threat?.coverage),
        definition.detectedBy,
        stated(threat?.note),
      ];
    }),
    [],
    ['Drivers by section'],
    ['Section', 'Side', 'Driver', 'Value', 'Unit', 'Category', 'Measured', 'Basis'],
    ...assessment.sections.flatMap((section) => [
      ...section.probability.drivers.map((driver) => [
        section.label, 'Probability — metal loss', driver.label, driver.value, driver.unit,
        driver.category, driver.measured ? 'Yes' : 'No', driver.basis,
      ]),
      ...section.probability.threats
        .filter((threat) => !threat.measured)
        .map((threat) => [
          section.label, 'Probability — threat', threat.label, null, '',
          threat.category, 'No', threat.basis,
        ]),
      ...section.consequence.drivers.map((driver) => [
        section.label, 'Consequence', driver.label, driver.value, driver.unit,
        driver.category, driver.measured ? 'Yes' : 'No', driver.basis,
      ]),
      [
        section.label, 'SECTION', 'Risk', null, '', section.riskLevel, '',
        `Probability ${section.probability.category} against consequence `
        + `${section.consequence.category}, governed by `
        + `${section.probability.governingThreat ?? 'no threat'}.`,
      ],
      [],
    ]),
  ]), 'Threats and drivers');

  /* Method and limits */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Risk matrix — probability (rows) against consequence (columns)'],
    ['P \\ C', 1, 2, 3, 4, 5],
    ...RISK_MATRIX.map((row, index) => [index + 1, ...row]),
    [],
    ['Risk acceptance'],
    ...Object.entries(RISK_ACCEPTANCE).map(([level, state]) => [level, state]),
    [],
    ['Maximum inspection interval by risk level [years]'],
    ...Object.entries(MAX_INTERVAL_YEARS).map(([level, years]) => [level, years]),
    ['Regulatory maximum [years]', stated(record.maxIntervalYears)],
    [],
    ['Rules applied'],
    ...assessment.provenance.rules.map((rule) => [rule]),
    [],
    ['What this assessment does not cover'],
    ...assessment.provenance.limitations.map((limit) => [limit]),
    [],
    ['This document supports engineering decision-making. It does not replace the judgement of a qualified '
      + 'integrity engineer, and it is not a regulatory inspection authorisation.'],
  ]), 'Method and limits');

  const blob = new Blob(
    [XLSX.write(book, { bookType: 'xlsx', type: 'array' })],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
  triggerDownload(blob, `${safeFilename(assessment.lineName)}_RBI.xlsx`);
}
