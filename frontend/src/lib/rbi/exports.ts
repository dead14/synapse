/**
 * The RBI workbook.
 *
 * API 580 §19 asks for the assessment to be documented in a way that can be
 * re-examined: the inputs, the rules, the result, and the plan that follows from
 * it. So the workbook carries all four — including the sheet nobody enjoys
 * writing, which states what the assessment does not cover. A risk report
 * without its limits reads as a clean bill of health for threats it never looked
 * at.
 */

import * as XLSX from 'xlsx';

import { safeFilename, triggerDownload } from '../ffs/exports.ts';
import { MAX_INTERVAL_YEARS, RISK_MATRIX } from './api580.ts';
import type { RbiAssessment } from './types.ts';

function sheetOf(rows: (string | number | null)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows.map((row) => row.map((cell) => (cell === null ? '' : cell))));
}

export function exportRbiWorkbook(assessment: RbiAssessment): void {
  const book = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Risk-based inspection assessment'],
    ['Practice', assessment.provenance.practice],
    ['Edition', assessment.provenance.edition],
    ['Approach', assessment.provenance.approach],
    ['Line', assessment.lineName],
    ['Derived from FFS session', assessment.ffsSessionId ?? 'Not recorded'],
    ['Inspection date (intervals count from here)', assessment.assessmentDateIso],
    ['Assessed features', assessment.totals.features],
    ['Anomalies with no B31G result', assessment.totals.unassessed],
    [],
    ['Units by risk level'],
    ...Object.entries(assessment.totals.byLevel).map(([level, total]) => [level, total]),
  ]), 'Assessment');

  XLSX.utils.book_append_sheet(book, sheetOf([
    [
      'Unit', 'From [m]', 'To [m]', 'Assessed features', 'Unassessed anomalies',
      'Likelihood', 'Consequence', 'Risk level',
      'Interval [y]', 'Interval basis', 'Next inspection', 'Recommendation',
      'Governing feature', 'Governing LD [m]', 'Governing ERF', 'Governing remaining life [y]',
      'Growth basis assumed',
    ],
    ...assessment.units.map((unit) => [
      unit.label,
      unit.fromM,
      unit.toM,
      unit.featureCount,
      unit.likelihood.unassessedCount,
      unit.likelihood.category,
      unit.consequence.category,
      unit.riskLevel,
      unit.inspection.intervalYears,
      unit.inspection.basis,
      unit.inspection.dueDateIso,
      unit.inspection.recommendation,
      unit.governingFeature?.featureId ?? '',
      unit.governingFeature?.ldM ?? null,
      unit.governingFeature?.erf ?? null,
      unit.governingFeature?.remnantLifeYears ?? null,
      unit.likelihood.growthAssumed ? 'Yes' : 'No',
    ]),
  ]), 'Inspection plan');

  // Every driver behind every category, so a reviewer can check a number rather
  // than take a category on trust.
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Unit', 'Side', 'Driver', 'Value', 'Unit', 'Category', 'Basis'],
    ...assessment.units.flatMap((unit) => [
      ...unit.likelihood.drivers.map((driver) => [
        unit.label, 'Likelihood', driver.label, driver.value, driver.unit, driver.category, driver.basis,
      ]),
      ...unit.consequence.drivers.map((driver) => [
        unit.label, 'Consequence', driver.label, driver.value, driver.unit, driver.category, driver.basis,
      ]),
    ]),
  ]), 'Drivers');

  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Risk matrix — likelihood (rows) against consequence (columns)'],
    ['L \\ C', 1, 2, 3, 4, 5],
    ...RISK_MATRIX.map((row, index) => [index + 1, ...row]),
    [],
    ['Maximum inspection interval by risk level [years]'],
    ...Object.entries(MAX_INTERVAL_YEARS).map(([level, years]) => [level, years]),
    [],
    ['Rules applied'],
    ...assessment.provenance.rules.map((rule) => [rule]),
  ]), 'Method');

  XLSX.utils.book_append_sheet(book, sheetOf([
    ['What this assessment does not cover'],
    ...assessment.provenance.limitations.map((limit) => [limit]),
    [],
    ['This document supports engineering decision-making. It does not replace the judgement of a '
      + 'qualified integrity engineer, and it is not a jurisdictional inspection authorisation.'],
  ]), 'Limitations');

  const blob = new Blob(
    [XLSX.write(book, { bookType: 'xlsx', type: 'array' })],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
  triggerDownload(blob, `${safeFilename(assessment.lineName)}_RBI_API580.xlsx`);
}
