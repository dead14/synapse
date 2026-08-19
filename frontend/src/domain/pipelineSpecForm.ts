/**
 * The typed form behind the pipeline dossier.
 *
 * Fields are held as the strings an engineer typed, in whichever unit the
 * screen is showing, and converted to the canonical record (millimetres,
 * megapascals) only on the way out. Holding them as numbers instead made a
 * half-typed "0." collapse to 0 and a blank optional field become a real zero
 * the moment the unit selector was touched.
 */

import {
  EMPTY_PIPELINE_SPECIFICATION,
  type PipelineSegment,
  type PipelineSpecification,
} from './pipelineSpecification.ts';
import {
  convertLength,
  convertPressure,
  toMegapascals,
  toMillimetres,
  type LengthUnit,
  type PressureUnit,
} from '../lib/ffs/units.ts';

export interface PipelineSegmentForm {
  key: string;
  label: string;
  startM: string;
  endM: string;
  outerDiameter: string;
  nominalWallThickness: string;
  smys: string;
  designFactor: string;
  materialGrade: string;
  seamType: string;
}

export interface PipelineSpecForm {
  diameterUnit: LengthUnit;
  pressureUnit: PressureUnit;
  environment: string;
  productMedium: string;
  lengthKm: string;
  locationClass: string;
  installationYear: string;
  commissioningYear: string;
  designLifeYears: string;
  outerDiameter: string;
  nominalWallThickness: string;
  smys: string;
  designFactor: string;
  materialGrade: string;
  seamType: string;
  externalCoating: string;
  maop: string;
  designPressure: string;
  operatingPressure: string;
  internalDesignPressure: string;
  weldJointFactor: string;
  yieldToTensileRatio: string;
  notes: string;
  segments: PipelineSegmentForm[];
}

/** Identity for a form row. Segments have no id until they are first filed. */
let segmentSequence = 0;
export function nextSegmentKey(): string {
  segmentSequence += 1;
  return `segment-${segmentSequence}`;
}

export function emptySegmentForm(label: string): PipelineSegmentForm {
  return {
    key: nextSegmentKey(),
    label,
    startM: '',
    endM: '',
    outerDiameter: '',
    nominalWallThickness: '',
    smys: '',
    designFactor: '',
    materialGrade: '',
    seamType: '',
  };
}

export const EMPTY_PIPELINE_SPEC_FORM: PipelineSpecForm = {
  diameterUnit: 'mm',
  pressureUnit: 'MPa',
  environment: '',
  productMedium: '',
  lengthKm: '',
  locationClass: '',
  installationYear: '',
  commissioningYear: '',
  designLifeYears: '',
  outerDiameter: '',
  nominalWallThickness: '',
  smys: '',
  designFactor: '',
  materialGrade: '',
  seamType: '',
  externalCoating: '',
  maop: '',
  designPressure: '',
  operatingPressure: '',
  internalDesignPressure: '',
  weldJointFactor: '',
  yieldToTensileRatio: '',
  notes: '',
  segments: [],
};

function display(value: number | null, convert: (input: number) => number): string {
  if (value === null || !Number.isFinite(value)) return '';
  return Number(convert(value).toFixed(6)).toString();
}

function plain(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : String(value);
}

/** The stored record as form strings, in the units the screen is showing. */
export function specificationToForm(
  specification: PipelineSpecification,
  units: { diameterUnit: LengthUnit; pressureUnit: PressureUnit } = { diameterUnit: 'mm', pressureUnit: 'MPa' },
): PipelineSpecForm {
  const { diameterUnit, pressureUnit } = units;
  const length = (value: number | null) => display(value, (input) => convertLength(input, 'mm', diameterUnit));
  const pressure = (value: number | null) => display(value, (input) => convertPressure(input, 'MPa', pressureUnit));

  return {
    diameterUnit,
    pressureUnit,
    environment: specification.environment ?? '',
    productMedium: specification.productMedium ?? '',
    lengthKm: plain(specification.lengthKm),
    locationClass: specification.locationClass ?? '',
    installationYear: plain(specification.installationYear),
    commissioningYear: plain(specification.commissioningYear),
    designLifeYears: plain(specification.designLifeYears),
    outerDiameter: length(specification.outerDiameterMm),
    nominalWallThickness: length(specification.nominalWallThicknessMm),
    smys: pressure(specification.smysMpa),
    designFactor: plain(specification.designFactor),
    materialGrade: specification.materialGrade ?? '',
    seamType: specification.seamType ?? '',
    externalCoating: specification.externalCoating ?? '',
    maop: pressure(specification.maopMpa),
    designPressure: pressure(specification.designPressureMpa),
    operatingPressure: pressure(specification.operatingPressureMpa),
    internalDesignPressure: pressure(specification.internalDesignPressureMpa),
    weldJointFactor: plain(specification.weldJointFactor),
    yieldToTensileRatio: plain(specification.yieldToTensileRatio),
    notes: specification.notes ?? '',
    segments: specification.segments.map((segment) => ({
      key: segment.id ? `segment-${segment.id}` : nextSegmentKey(),
      label: segment.label,
      startM: plain(segment.startM),
      endM: plain(segment.endM),
      outerDiameter: length(segment.outerDiameterMm),
      nominalWallThickness: length(segment.nominalWallThicknessMm),
      smys: pressure(segment.smysMpa),
      designFactor: plain(segment.designFactor),
      materialGrade: segment.materialGrade ?? '',
      seamType: segment.seamType ?? '',
    })),
  };
}

function parsed(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** The canonical record the API stores, converted out of the shown units. */
export function formToSpecification(form: PipelineSpecForm): PipelineSpecification {
  const length = (value: string) => {
    const number = parsed(value);
    return number === null ? null : toMillimetres(number, form.diameterUnit);
  };
  const pressure = (value: string) => {
    const number = parsed(value);
    return number === null ? null : toMegapascals(number, form.pressureUnit);
  };

  return {
    ...EMPTY_PIPELINE_SPECIFICATION,
    environment: text(form.environment),
    productMedium: text(form.productMedium),
    lengthKm: parsed(form.lengthKm),
    locationClass: text(form.locationClass),
    installationYear: parsed(form.installationYear),
    commissioningYear: parsed(form.commissioningYear),
    designLifeYears: parsed(form.designLifeYears),
    outerDiameterMm: length(form.outerDiameter),
    nominalWallThicknessMm: length(form.nominalWallThickness),
    smysMpa: pressure(form.smys),
    designFactor: parsed(form.designFactor),
    materialGrade: text(form.materialGrade),
    seamType: text(form.seamType),
    externalCoating: text(form.externalCoating),
    maopMpa: pressure(form.maop),
    designPressureMpa: pressure(form.designPressure),
    operatingPressureMpa: pressure(form.operatingPressure),
    internalDesignPressureMpa: pressure(form.internalDesignPressure),
    weldJointFactor: parsed(form.weldJointFactor),
    yieldToTensileRatio: parsed(form.yieldToTensileRatio),
    notes: text(form.notes),
    segments: form.segments.map((segment, index): PipelineSegment => ({
      label: text(segment.label) ?? `Segment ${index + 1}`,
      startM: parsed(segment.startM),
      endM: parsed(segment.endM),
      outerDiameterMm: length(segment.outerDiameter),
      nominalWallThicknessMm: length(segment.nominalWallThickness),
      smysMpa: pressure(segment.smys),
      designFactor: parsed(segment.designFactor),
      materialGrade: text(segment.materialGrade),
      seamType: text(segment.seamType),
    })),
  };
}

/** Re-labels the typed figures when the shown unit changes. */
export function reunitForm(
  form: PipelineSpecForm,
  next: { diameterUnit?: LengthUnit; pressureUnit?: PressureUnit },
): PipelineSpecForm {
  const diameterUnit = next.diameterUnit ?? form.diameterUnit;
  const pressureUnit = next.pressureUnit ?? form.pressureUnit;
  const length = (value: string) => {
    const number = parsed(value);
    if (number === null) return value;
    return Number(convertLength(number, form.diameterUnit, diameterUnit).toFixed(6)).toString();
  };
  const pressure = (value: string) => {
    const number = parsed(value);
    if (number === null) return value;
    return Number(convertPressure(number, form.pressureUnit, pressureUnit).toFixed(6)).toString();
  };

  return {
    ...form,
    diameterUnit,
    pressureUnit,
    outerDiameter: length(form.outerDiameter),
    nominalWallThickness: length(form.nominalWallThickness),
    smys: pressure(form.smys),
    maop: pressure(form.maop),
    designPressure: pressure(form.designPressure),
    operatingPressure: pressure(form.operatingPressure),
    internalDesignPressure: pressure(form.internalDesignPressure),
    segments: form.segments.map((segment) => ({
      ...segment,
      outerDiameter: length(segment.outerDiameter),
      nominalWallThickness: length(segment.nominalWallThickness),
      smys: pressure(segment.smys),
    })),
  };
}

/**
 * What the form cannot be filed as, in the engineer's own words.
 *
 * The server enforces the same bounds; these exist so a mistake is visible
 * beside the field instead of arriving as a rejected save after the whole
 * intake has been submitted.
 */
export function pipelineSpecFormProblems(form: PipelineSpecForm): string[] {
  const problems: string[] = [];
  const specification = formToSpecification(form);

  const numericFields: Array<[string, string]> = [
    ['pipe length', form.lengthKm],
    ['outer diameter', form.outerDiameter],
    ['nominal wall thickness', form.nominalWallThickness],
    ['SMYS', form.smys],
    ['design factor', form.designFactor],
    ['MAOP', form.maop],
    ['design pressure', form.designPressure],
    ['operating pressure', form.operatingPressure],
    ['internal design pressure', form.internalDesignPressure],
    ['design life', form.designLifeYears],
    ['installation year', form.installationYear],
    ['commissioning year', form.commissioningYear],
    ['yield-to-tensile ratio', form.yieldToTensileRatio],
  ];
  for (const [label, value] of numericFields) {
    if (value.trim() !== '' && parsed(value) === null) {
      problems.push(`The ${label} is not a number.`);
    }
  }

  if (specification.designFactor !== null
    && (specification.designFactor <= 0 || specification.designFactor > 1)) {
    problems.push('The design factor must be greater than 0 and not more than 1.');
  }
  if (specification.outerDiameterMm !== null && specification.outerDiameterMm < 50) {
    problems.push('The outer diameter must be at least 50 mm.');
  }
  if (specification.outerDiameterMm !== null
    && specification.nominalWallThicknessMm !== null
    && specification.outerDiameterMm <= 2 * specification.nominalWallThicknessMm) {
    problems.push('The line wall thickness leaves no bore at that outer diameter — check for a transposed pair.');
  }

  specification.segments.forEach((segment, index) => {
    const name = segment.label || `Segment ${index + 1}`;
    if (segment.startM !== null && segment.endM !== null && segment.endM <= segment.startM) {
      problems.push(`${name} must end after it starts.`);
    }
    if (segment.outerDiameterMm !== null && segment.outerDiameterMm < 50) {
      problems.push(`${name} outer diameter must be at least 50 mm.`);
    }
    if (segment.designFactor !== null && (segment.designFactor <= 0 || segment.designFactor > 1)) {
      problems.push(`${name} design factor must be greater than 0 and not more than 1.`);
    }
    const diameter = segment.outerDiameterMm ?? specification.outerDiameterMm;
    if (segment.nominalWallThicknessMm !== null
      && diameter !== null
      && diameter <= 2 * segment.nominalWallThicknessMm) {
      problems.push(`${name} wall thickness leaves no bore at that outer diameter.`);
    }
  });

  return problems;
}
