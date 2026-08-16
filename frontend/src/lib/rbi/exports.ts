/**
 * The RBI workbook.
 *
 * §16.2 asks for the assessment to be documented so completely that it "can be
 * recreated or updated at a later time by others who were not involved in the
 * original assessment". That is a high bar, and it is the bar this workbook is
 * built to: a sheet per section of the practice, carrying the inputs, the team,
 * the mechanisms, the rules, the result, the plan, and the Appendix A checklist
 * showing what is still missing.
 *
 * Including the sheet nobody enjoys writing — what the assessment does not
 * cover. A risk report without its limits reads as a clean bill of health for
 * threats it never looked at.
 */

import * as XLSX from 'xlsx';

import { safeFilename, triggerDownload } from '../ffs/exports.ts';
import { MAX_INTERVAL_YEARS, RISK_MATRIX } from './api580.ts';
import {
  CODES_AND_STANDARDS,
  DATA_SOURCES,
  EQUIPMENT_CLASSES,
  OTHER_LOSS_CAUSES,
  RBI_OBJECTIVES,
  REASSESSMENT_TRIGGERS,
  TEAM_ROLES,
} from './catalogues.ts';
import { evaluateChecklist } from './checklist.ts';
import { mechanismName } from './record.ts';
import type { Option } from './catalogues.ts';
import type { RbiAssessment } from './types.ts';

type Cell = string | number | null;

function sheetOf(rows: Cell[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows.map((row) => row.map((cell) => (cell === null ? '' : cell))));
}

/** Ids come out of the record; a report needs the words, not the slugs. */
function labelsFor(ids: readonly string[], catalogue: readonly Option[]): string {
  if (ids.length === 0) return 'None recorded';
  return ids
    .map((id) => catalogue.find((option) => option.value === id)?.label ?? id)
    .join('; ');
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

/** A blank in a report should say it is blank, not look like a zero. */
function stated(value: string | number | null | undefined): Cell {
  if (value === null || value === undefined) return 'Not stated';
  if (typeof value === 'string') return value.trim() === '' ? 'Not stated' : value;
  return value;
}

export function exportRbiWorkbook(assessment: RbiAssessment): void {
  const { record } = assessment;
  const checklist = evaluateChecklist(record);
  const book = XLSX.utils.book_new();

  // An IOW names the mechanism it protects against. An orphaned reference says
  // so rather than rendering an empty cell that reads as "no mechanism".
  const protectedMechanism = (rowId: string): string => {
    const row = record.dmr.mechanisms.find((item) => item.id === rowId);
    return row ? mechanismName(row) : 'Not linked to a mechanism';
  };

  /* ── Cover (§16.2) ──────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Risk-based inspection assessment'],
    ['Title', stated(record.title)],
    ['Practice', assessment.provenance.practice],
    ['Edition', assessment.provenance.edition],
    ['Type of assessment', assessment.provenance.approach],
    [],
    ['Line', assessment.lineName],
    ['Facility', stated(record.planning.facility)],
    ['Process unit', stated(record.planning.processUnit)],
    ['System / circuit', stated(record.planning.system)],
    [],
    ['Derived from FFS session', stated(record.ffsSessionId)],
    ['Inspection date (intervals count from here)', assessment.assessmentDateIso],
    ['Assessed features', assessment.totals.features],
    ['Anomalies with no B31G result', assessment.totals.unassessed],
    ['Assessed units', assessment.units.length],
    ['Earliest inspection due', stated(assessment.totals.nextDueIso)],
    [],
    ['Applicable from', stated(record.planning.timeframeFromIso)],
    ['Applicable to', stated(record.planning.timeframeToIso)],
    [],
    ['Units by risk level'],
    ...Object.entries(assessment.totals.byLevel).map(([level, total]) => [level, total]),
    [],
    ['Units by risk acceptance'],
    ...Object.entries(assessment.totals.byAcceptance).map(([state, total]) => [state, total]),
    [],
    ['Sign-off (§16.5)'],
    ['Assessed by', stated(record.documentation.assessedBy), stated(record.documentation.assessedOnIso)],
    ['Reviewed by', stated(record.documentation.reviewedBy), stated(record.documentation.reviewedOnIso)],
    ['Approved by', stated(record.documentation.approvedBy), stated(record.documentation.approvedOnIso)],
    [],
    ['Appendix A shall-items met', `${checklist.shallMet} of ${checklist.shallTotal}`],
    ['Appendix A should-items met', `${checklist.shouldMet} of ${checklist.shouldTotal}`],
  ]), 'Assessment');

  /* ── §6 Planning ────────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Planning and scope — API 580 §6, §16.4'],
    [],
    ['Objectives (§6.2)', labelsFor(record.planning.objectives, RBI_OBJECTIVES)],
    ['Objectives note', stated(record.planning.objectivesNote)],
    [],
    ['Equipment covered (§16.4)', labelsFor(record.planning.includedEquipment, EQUIPMENT_CLASSES)],
    ['Equipment not covered (§16.4)', labelsFor(record.planning.excludedEquipment, EQUIPMENT_CLASSES)],
    ['Scope rationale', stated(record.planning.scopeRationale)],
    [],
    ['Operating boundary (§6.4)'],
    ['Normal pressure [MPa]', stated(record.planning.operating.normalPressureMpa)],
    ['Normal temperature [°C]', stated(record.planning.operating.normalTemperatureC)],
    ['Pressure range [MPa]',
      `${stated(record.planning.operating.minPressureMpa)} to ${stated(record.planning.operating.maxPressureMpa)}`],
    ['Temperature range [°C]',
      `${stated(record.planning.operating.minTemperatureC)} to ${stated(record.planning.operating.maxTemperatureC)}`],
    ['Flow', stated(record.planning.operating.flowNote)],
    ['Start-up and shutdown considered (§6.4.2)',
      yesNo(record.planning.operating.startupShutdownConsidered),
      stated(record.planning.operating.startupShutdownNote)],
    ['Upset conditions considered (§6.4.3)',
      yesNo(record.planning.operating.upsetConsidered),
      stated(record.planning.operating.upsetNote)],
    ['Cyclic operation considered (§6.4.3)',
      yesNo(record.planning.operating.cyclicConsidered),
      stated(record.planning.operating.cyclicNote)],
    [],
    ['Operating time period (§6.4.4)'],
    ['Applicable from', stated(record.planning.timeframeFromIso)],
    ['Applicable to', stated(record.planning.timeframeToIso)],
    ['Run length [y]', stated(record.planning.runLengthYears)],
    [],
    ['Codes and standards (§16.11)', labelsFor(record.planning.codes, CODES_AND_STANDARDS)],
    ['Codes note', stated(record.planning.codesNote)],
    ['Jurisdictional maximum interval [y]', stated(record.planning.jurisdictionalMaxIntervalYears)],
  ]), 'Planning');

  /* ── §7 Team ────────────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Assessment team — API 580 §7, §16.5'],
    [],
    ['Name', 'Role', 'Organization', 'Qualification / experience'],
    ...record.team.map((member) => [
      stated(member.name),
      TEAM_ROLES.find((role) => role.value === member.role)?.label ?? stated(member.role),
      stated(member.organization),
      stated(member.qualification),
    ]),
    ...(record.team.length === 0 ? [['No team members recorded.']] : []),
    [],
    ['Corrosion specialist consulted (§9.1)', stated(record.dmr.corrosionSpecialist)],
    ['Damage mechanism review date', stated(record.dmr.reviewDateIso)],
  ]), 'Team');

  /* ── §8 Data ────────────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Data and information collection — API 580 §8'],
    [],
    ['Source (§8.5)', 'Availability', 'Quality (§8.3)', 'Note'],
    ...record.data.sources.map((source) => [
      DATA_SOURCES.find((item) => item.value === source.id)?.label ?? source.id,
      source.availability,
      source.quality,
      stated(source.note),
    ]),
    ...(record.data.sources.length === 0 ? [['No data sources recorded.']] : []),
    [],
    ['Data validated by (§8.3 — a shall)', stated(record.data.validatedBy)],
    ['Validated on', stated(record.data.validatedOnIso)],
    ['Validation note', stated(record.data.validationNote)],
    [],
    ['Equipment data (§8.2.1)'],
    ['Outer diameter [mm]', stated(record.data.equipment.outerDiameterMm)],
    ['Nominal wall [mm]', stated(record.data.equipment.nominalWallMm)],
    ['Material', stated(record.data.equipment.material)],
    ['Grade', stated(record.data.equipment.grade)],
    ['SMYS [MPa]', stated(record.data.equipment.smysMpa)],
    ['Design pressure [MPa]', stated(record.data.equipment.designPressureMpa)],
    ['Design temperature [°C]', stated(record.data.equipment.designTemperatureC)],
    ['Corrosion allowance [mm]', stated(record.data.equipment.corrosionAllowanceMm)],
    ['Installed', stated(record.data.equipment.installedYear)],
    ['Seam type', stated(record.data.equipment.seamType)],
    ['External coating', stated(record.data.equipment.externalCoating)],
    ['Insulated', yesNo(record.data.equipment.insulated)],
    ['Cathodic protection', stated(record.data.equipment.cathodicProtection)],
    ['Note', stated(record.data.equipment.note)],
    [],
    ['Process data (§9.1 b — trace constituents matter)'],
    ['Fluid', record.data.process.fluid],
    ['Phase', record.data.process.phase],
    ['Composition', stated(record.data.process.composition)],
    ['H₂S [ppm]', stated(record.data.process.h2sPpm)],
    ['CO₂ [%]', stated(record.data.process.co2Pct)],
    ['Chlorides [ppm]', stated(record.data.process.chloridesPpm)],
    ['Water cut [%]', stated(record.data.process.waterCutPct)],
    ['pH', stated(record.data.process.ph)],
    ['Velocity [m/s]', stated(record.data.process.velocityMs)],
    ['Injection / mixing points', stated(record.data.process.injectionPoints)],
    ['Note', stated(record.data.process.note)],
    [],
    ['Inventory and isolation (§11.4)'],
    ['Volume available for release [m³]', stated(record.data.inventory.volumeM3)],
    ['Isolation arrangement', stated(record.data.inventory.isolationDescription)],
    ['Detection rating', record.data.inventory.detectionSystem],
    ['Isolation rating', record.data.inventory.isolationSystem],
    ['Detection time [min]', stated(record.data.inventory.detectionTimeMin)],
    ['Isolation time [min]', stated(record.data.inventory.isolationTimeMin)],
    ['Spill containment', record.data.inventory.spillContainment],
    ['Note', stated(record.data.inventory.note)],
  ]), 'Data');

  /* ── §9 Damage mechanism review ─────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Damage mechanism review — API 580 §9'],
    ['Corrosion specialist (§9.1)', stated(record.dmr.corrosionSpecialist)],
    ['Rate sources (§9.2)', stated(record.dmr.rateSources)],
    [],
    [
      'Mechanism', 'Status', 'Damage mode', 'Failure mode', 'Rate basis', 'Rate [mm/y]',
      'Susceptibility', 'Inspection effectiveness', 'Method', 'Coverage [%]', 'Last inspection',
      'Evidence / basis', 'Reason ruled out', 'Planned technique',
    ],
    ...record.dmr.mechanisms.map((row) => [
      mechanismName(row),
      row.status,
      stated(row.damageMode),
      row.failureMode,
      row.rateBasis,
      stated(row.rateMmPerYear),
      row.rateBasis === 'susceptibility' ? row.susceptibility : '',
      row.effectiveness,
      stated(row.inspectionMethod),
      stated(row.coveragePct),
      stated(row.lastInspectionIso),
      stated(row.basis),
      row.status === 'ruled-out' ? stated(row.ruledOutReason) : '',
      stated(row.plannedTechnique),
    ]),
    ...(record.dmr.mechanisms.length === 0 ? [['No damage mechanisms recorded.']] : []),
    [],
    ['Integrity operating windows (§9.4, §14.8)'],
    ['Parameter', 'Unit', 'Low limit', 'High limit', 'Protects against', 'Action on exceedance'],
    ...record.dmr.iows.map((row) => [
      stated(row.parameter),
      stated(row.unit),
      stated(row.lowLimit),
      stated(row.highLimit),
      protectedMechanism(row.mechanismRowId),
      stated(row.actionOnExceedance),
    ]),
    ...(record.dmr.iows.length === 0 ? [['No integrity operating windows recorded.']] : []),
    [],
    ['Other causes of loss of containment considered (§10.1)',
      labelsFor(record.dmr.otherCauses, OTHER_LOSS_CAUSES)],
    ['Note', stated(record.dmr.otherCausesNote)],
    ['These are recorded as considered. They are not scored in the probability.'],
  ]), 'Damage mechanisms');

  /* ── §10 POF ────────────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Probability of failure — API 580 §10'],
    ['The unit takes the worst contribution across all credible mechanisms (§10.1), never an average.'],
    [],
    [
      'Unit', 'Mechanism', 'Status', 'Rate basis', 'Base category', 'Inspection effectiveness',
      'Adjustment', 'Category', 'Measured', 'Basis',
    ],
    ...assessment.units.flatMap((unit) => [
      ...unit.probability.drivers.map((driver) => [
        unit.label,
        `Measured metal loss — ${driver.label}`,
        'active',
        'measured-ili',
        driver.category,
        'n/a — the inspection is the measurement',
        0,
        driver.category,
        yesNo(driver.measured),
        driver.basis,
      ]),
      ...unit.probability.mechanisms.map((item) => [
        unit.label,
        item.name,
        item.status,
        item.rateBasis,
        item.baseCategory,
        item.effectiveness,
        item.effectivenessDelta,
        item.category,
        yesNo(item.measured),
        item.basis,
      ]),
      [
        unit.label, 'UNIT PROBABILITY', '', '', '', '', '',
        unit.probability.category,
        yesNo(!unit.probability.growthAssumed),
        `Governed by ${unit.probability.governingMechanism ?? 'no mechanism'}.`
        + (unit.probability.unassessedCount > 0
          ? ` ${unit.probability.unassessedCount} anomaly/anomalies here carried no B31G result.`
          : ''),
      ],
      [],
    ]),
  ]), 'POF');

  /* ── §11 COF ────────────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Consequence of failure — API 580 §11'],
    ['Four components assessed separately (§11.1.1); the worst governs.'],
    ['Consequence basis note', stated(record.consequence.basisNote)],
    [],
    ['Unit', 'Component', 'Category', 'Driver', 'Value', 'Unit', 'Driver category', 'Basis'],
    ...assessment.units.flatMap((unit) => [
      ...unit.consequence.components.flatMap((component) => component.drivers.map((driver) => [
        unit.label,
        component.label,
        component.category,
        driver.label,
        driver.value,
        driver.unit,
        driver.category,
        driver.basis,
      ])),
      [
        unit.label, 'UNIT CONSEQUENCE', unit.consequence.category, '', null, '', '',
        unit.consequence.overridden
          ? 'This unit’s surroundings were overridden from the line default.'
          : 'Line default surroundings.',
      ],
      [],
    ]),
    ['Section overrides (§11.1.1 — discrimination between items)'],
    ['Unit', 'Population', 'Environmental receptor', 'Note'],
    ...record.consequenceOverrides.map((row) => [
      row.unitId,
      stated(row.population),
      stated(row.environmentReceptor),
      stated(row.note),
    ]),
    ...(record.consequenceOverrides.length === 0 ? [['No section overrides; the line default applies throughout.']] : []),
  ]), 'COF');

  /* ── §12 Risk ───────────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Risk determination — API 580 §12'],
    [],
    ['Risk matrix — probability (rows) against consequence (columns)'],
    ['P \\ C', 1, 2, 3, 4, 5],
    ...RISK_MATRIX.map((row, index) => [index + 1, ...row]),
    [],
    ['Risk acceptance criteria (§12.3, §12.7)'],
    ['Criteria source', stated(record.risk.criteriaSource)],
    ...Object.entries(record.risk.acceptance).map(([level, state]) => [level, state]),
    [],
    ['Maximum inspection interval by risk level [years]'],
    ...Object.entries(MAX_INTERVAL_YEARS).map(([level, years]) => [level, years]),
    ['Jurisdictional maximum [years]', stated(record.planning.jurisdictionalMaxIntervalYears)],
    [],
    ['Assumptions register (§12.6, §16.7 — a shall)'],
    ['Assumption', 'Basis', 'Impact if wrong'],
    ...record.risk.assumptions.map((row) => [
      stated(row.assumption), stated(row.basis), stated(row.impactIfWrong),
    ]),
    ...(record.risk.assumptions.length === 0 ? [['No assumptions recorded. Every assessment has them.']] : []),
    [],
    ['Sensitivity review (§12.4)', stated(record.risk.sensitivityNote)],
    [],
    ['Rules applied (§16.3)'],
    ...assessment.provenance.rules.map((rule) => [rule]),
  ]), 'Risk');

  /* ── §13 / §14 Inspection plan and mitigation ───────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Inspection plan and risk management — API 580 §13, §14'],
    [],
    [
      'Unit', 'From [m]', 'To [m]', 'Assessed features', 'Unassessed anomalies',
      'Probability', 'Consequence', 'Risk level', 'Acceptance',
      'Interval [y]', 'Interval basis', 'Next inspection',
      'Technique', 'Coverage [%]', 'Locations',
      'Strategy', 'Mitigation', 'Owner', 'Target date', 'Residual risk',
      'Governing mechanism', 'Governing feature', 'Governing LD [m]', 'Governing ERF',
      'Governing remaining life [y]', 'Growth basis assumed', 'Recommendation',
    ],
    ...assessment.units.map((unit) => [
      unit.label,
      unit.fromM,
      unit.toM,
      unit.featureCount,
      unit.probability.unassessedCount,
      unit.probability.category,
      unit.consequence.category,
      unit.riskLevel,
      unit.acceptance,
      unit.inspection.intervalYears,
      unit.inspection.basis,
      unit.inspection.dueDateIso,
      stated(unit.inspection.technique),
      stated(unit.inspection.coveragePct),
      stated(unit.inspection.locations),
      unit.inspection.strategy,
      stated(unit.inspection.mitigationNote),
      stated(unit.inspection.owner),
      stated(unit.inspection.targetDateIso),
      stated(unit.inspection.residualRiskLevel),
      stated(unit.probability.governingMechanism),
      unit.governingFeature?.featureId ?? '',
      unit.governingFeature?.ldM ?? null,
      unit.governingFeature?.erf ?? null,
      unit.governingFeature?.remnantLifeYears ?? null,
      yesNo(unit.probability.growthAssumed),
      unit.inspection.recommendation,
    ]),
    [],
    ['Interval overrides (§16.7 — a deviation and its basis)'],
    ['Unit', 'Override [y]', 'Reason'],
    ...record.unitPlans.filter((row) => row.overrideIntervalYears !== null).map((row) => [
      row.unitId, row.overrideIntervalYears, stated(row.overrideReason),
    ]),
  ]), 'Inspection plan');

  /* ── §15 Evergreening ───────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Evergreening and reassessment — API 580 §15'],
    [],
    ['Reassessment triggers (§15.2)', labelsFor(record.evergreening.triggers, REASSESSMENT_TRIGGERS)],
    ['Trigger note', stated(record.evergreening.triggersNote)],
    [],
    ['Maximum period between reassessments [y]', stated(record.evergreening.reassessmentIntervalYears)],
    ['Next reassessment due', stated(record.evergreening.nextReassessmentIso)],
    ['API 510 / API 570 ceiling [y]', 10],
    [],
    ['Evergreening owner (§15.1.1)', stated(record.evergreening.evergreenOwner)],
    ['Evergreening process', stated(record.evergreening.evergreenProcess)],
  ]), 'Evergreening');

  /* ── Appendix A checklist ───────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['Appendix A — checklist for creating an RBI programme'],
    [`Shall items met: ${checklist.shallMet} of ${checklist.shallTotal}`],
    [`Should items met: ${checklist.shouldMet} of ${checklist.shouldTotal}`],
    [],
    ['Source', 'Level', 'Requirement', 'Met', 'What is missing'],
    ...checklist.items.map((item) => [
      item.section,
      item.level.toUpperCase(),
      item.requirement,
      item.satisfied ? 'Yes' : 'No',
      item.satisfied ? '' : item.remedy,
    ]),
  ]), 'Appendix A');

  /* ── Limitations ────────────────────────────────────────────────────────── */
  XLSX.utils.book_append_sheet(book, sheetOf([
    ['What this assessment does not cover'],
    ...assessment.provenance.limitations.map((limit) => [limit]),
    [],
    ['Methodology note (§16.3)', stated(record.documentation.methodologyNote)],
    ['Distribution', stated(record.documentation.distribution)],
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
