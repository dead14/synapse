import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlignmentImportReadiness, mapAlignmentRowsToFfs } from '../src/lib/ffs/alignmentImport.ts';

const engineering = {
  outerDiameterMm: 508,
  smysMpa: 359,
  designFactor: 0.72,
  operatingPressureMpa: 7.2,
  fallbackDepthGrowthMmPerYear: 0,
  fallbackLengthGrowthMmPerYear: 0,
};

test('maps the NEW-run alignment anomaly and converts depth growth from %WT/year to mm/year', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Source Key NEW': 'new:42',
    'Identif. NEW': 'A-42',
    'Log Dist NEW (m)': 123.45,
    'Section NEW': 'KP 0-5',
    'Surface NEW': 'External',
    'Depth NEW (%WT)': 35,
    'Length NEW (mm)': 120,
    'Width NEW (mm)': 45,
    "O'Clock NEW": '03:30',
    'Wall WT NEW (mm)': 12.7,
    'Depth Growth (%WT/yr)': 1.5,
    'Length Growth (mm/yr)': 4,
  }], engineering, '77');

  assert.equal(mapped.accepted.length, 1);
  assert.equal(mapped.rejected.length, 0);
  assert.deepEqual(mapped.accepted[0].row, {
    'LD [m]': '123.45',
    Section: 'KP 0-5',
    Surface: 'External',
    'Max Depth [%]': '35',
    'Length [mm]': '120',
    'Width [mm]': '45',
    'Orient. (hrs:mins)': '03:30',
    'Nominal Wall Thickness [mm]': '12.7',
    'CR Depth [mm/y]': '0.1905',
    'CR Length [mm/y]': '4',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure Pâ‚€ [MPa]': '7.2',
  });
  assert.deepEqual(mapped.accepted[0].provenance, {
    alignmentSessionId: '77',
    sourceFeatureKey: 'new:42',
    featureId: 'A-42',
  });
});

test('uses explicit fallback corrosion rates when alignment growth is unavailable', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Source Key NEW': 'new:7',
    'Log Dist NEW (m)': 10,
    'Depth NEW (%WT)': 20,
    'Length NEW (mm)': 50,
    'Width NEW (mm)': 20,
    'Wall WT NEW (mm)': 10,
  }], {
    ...engineering,
    fallbackDepthGrowthMmPerYear: 0.25,
    fallbackLengthGrowthMmPerYear: 2,
  }, '9');

  assert.equal(mapped.accepted[0].row['CR Depth [mm/y]'], '0.25');
  assert.equal(mapped.accepted[0].row['CR Length [mm/y]'], '2');
  assert.deepEqual(mapped.accepted[0].warnings, [
    'Depth growth unavailable; explicit fallback rate was used.',
    'Length growth unavailable; explicit fallback rate was used.',
  ]);
});

test('rejects rows without a NEW feature or required measured anomaly dimensions', () => {
  const mapped = mapAlignmentRowsToFfs([
    {
      'Source Key NEW': '-',
      'Source Key OLD': 'old:1',
      'Depth OLD (%WT)': 30,
    },
    {
      'Source Key NEW': 'new:2',
      'Log Dist NEW (m)': 20,
      'Depth NEW (%WT)': 25,
      'Length NEW (mm)': '-',
      'Width NEW (mm)': 10,
      'Wall WT NEW (mm)': 8,
    },
  ], engineering, '10');

  assert.equal(mapped.accepted.length, 0);
  assert.equal(mapped.rejected.length, 2);
  assert.match(mapped.rejected[0].reason, /NEW-run feature/i);
  assert.match(mapped.rejected[1].reason, /Length NEW/);
});

test('explains every condition that keeps alignment assessment disabled', () => {
  assert.deepEqual(getAlignmentImportReadiness({
    lineName: 'HU CPA',
    iliDate: '1998-07-03',
    selectedRunId: '12',
    alignmentRowCount: 0,
    outerDiameterMm: '8',
    smysMpa: '64',
    designFactor: '3,72',
    operatingPressureMpa: '56',
    fallbackDepthGrowthMmPerYear: '2',
    fallbackLengthGrowthMmPerYear: '0.5',
  }), [
    'Load the selected alignment result first.',
    'Outer diameter must be at least 50 mm.',
    'Design factor must be a number greater than 0 and not more than 1 (example: 0.72).',
  ]);
});
