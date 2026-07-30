// NIST pressure conversion basis:
// https://www.nist.gov/pml/owm/metric-si/unit-conversion/pressure-and-gas-flow-unit-conversions
export const MEGAPASCALS_PER_PSI = 0.006894757;
export const MEGAPASCALS_PER_KSI = MEGAPASCALS_PER_PSI * 1_000;
export const MEGAPASCALS_PER_BAR = 0.1;

// The international inch is exactly 25.4 mm.
// https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors
export const MILLIMETRES_PER_INCH = 25.4;

export type PressureUnit = 'MPa' | 'bar' | 'psi';
export type LengthUnit = 'mm' | 'in';

function requireFinite(value: number, unit: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${unit} value must be finite`);
  }
  return value;
}

export function psiToMegapascals(psi: number): number {
  return requireFinite(psi, 'psi') * MEGAPASCALS_PER_PSI;
}

export function ksiToMegapascals(ksi: number): number {
  return requireFinite(ksi, 'ksi') * MEGAPASCALS_PER_KSI;
}

export function barToMegapascals(bar: number): number {
  return requireFinite(bar, 'bar') * MEGAPASCALS_PER_BAR;
}

export function inchesToMillimetres(inches: number): number {
  return requireFinite(inches, 'inch') * MILLIMETRES_PER_INCH;
}

export function millimetresToInches(millimetres: number): number {
  return requireFinite(millimetres, 'millimetre') / MILLIMETRES_PER_INCH;
}

export function toMegapascals(value: number, unit: PressureUnit): number {
  if (unit === 'MPa') return requireFinite(value, unit);
  if (unit === 'bar') return barToMegapascals(value);
  return psiToMegapascals(value);
}

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit): number {
  const mpa = toMegapascals(value, from);
  if (to === 'MPa') return mpa;
  if (to === 'bar') return mpa / MEGAPASCALS_PER_BAR;
  return mpa / MEGAPASCALS_PER_PSI;
}

export function toMillimetres(value: number, unit: LengthUnit): number {
  return unit === 'mm' ? requireFinite(value, unit) : inchesToMillimetres(value);
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  const millimetres = toMillimetres(value, from);
  return to === 'mm' ? millimetres : millimetresToInches(millimetres);
}

export function formatConvertedValue(value: number, from: LengthUnit, to: LengthUnit): string {
  return Number(convertLength(value, from, to).toFixed(6)).toString();
}
