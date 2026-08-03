import test from 'node:test';
import assert from 'node:assert/strict';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import {
  applicabilityStatus,
  engineeringDisposition,
  methodProfileLabel,
  pressureBasisLabel,
} from '../src/lib/ffs/assessmentProfile.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Profile test',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-01-01'),
  highlightYears: 5,
  pressureBasis: 'maop',
};

function input(overrides: Partial<Record<string, string>> = {}) {
  return {
    'LD [m]': '100',
    Section: 'A',
    Surface: 'External',
    'Max Depth [%]': '30',
    'Length [mm]': '80',
    'Width [mm]': '40',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '10',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '5',
    ...overrides,
  };
}

test('method and pressure labels expose the complete calculation profile', () => {
  assert.match(methodProfileLabel(config), /Modified B31G.*0\.85.*SMYS \+ 69 MPa/);
  assert.equal(pressureBasisLabel(config), 'MAOP');
});

test('applicability limitations stay separate from a passing numerical result', () => {
  const item = screenResults([processRow(input(), config)], config, DEFAULT_SCREENING_CONFIG)[0];

  assert.equal(item.nominal.acceptance, 'Acceptable');
  assert.equal(applicabilityStatus(item), 'limited');
  assert.equal(engineeringDisposition(item), 'Screening pass — verify applicability');
});

test('NEW-only estimated growth requires engineering review even when strength passes', () => {
  const nominal = processRow(input(), config);
  nominal.growthEvidence = {
    oldSurveyYear: 2020,
    newSurveyYear: 2024,
    intervalYears: 4,
    depth: {
      observation: 'new-only-zero-baseline-estimate',
      analysisBasis: 'estimated',
      rawRateMmPerYear: null,
      analysisRateMmPerYear: 0.75,
      formula: '(30 / 100 x 10 mm - 0 mm) / 4 y',
      note: 'Zero-baseline estimate.',
    },
    length: nominal.growthEvidence!.length,
  };
  nominal.crDepth = 0.75;
  const item = screenResults([nominal], config, DEFAULT_SCREENING_CONFIG)[0];

  assert.equal(item.nominal.acceptance, 'Acceptable');
  assert.equal(engineeringDisposition(item), 'Engineering review');
});
