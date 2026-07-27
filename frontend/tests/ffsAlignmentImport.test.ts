import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlignmentImportReadiness, mapAlignmentRowsToFfs } from '../src/lib/ffs/alignmentImport.ts';
import { REQUIRED_COLUMNS } from '../src/lib/ffs/types.ts';
import { validateData } from '../src/lib/ffs/validation.ts';

const engineering = {
  outerDiameterMm: 508,
  smysMpa: 359,
  designFactor: 0.72,
  operatingPressureMpa: 7.2,
  fallbackDepthGrowthMmPerYear: 0,
  fallbackLengthGrowthMmPerYear: 0,
};

function released(...keys: string[]) {
  return { selectedKeys: new Set(keys) };
}

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
  }], engineering, '77', {
    selectedKeys: new Set(['new:42']),
    reasons: { 'new:42': 'Active growth at 3 o’clock' },
  });

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
    'Operating Pressure P₀ [MPa]': '7.2',
  });
  assert.deepEqual(mapped.accepted[0].provenance, {
    alignmentSessionId: '77',
    sourceFeatureKey: 'new:42',
    featureId: 'A-42',
    selectionReason: 'Active growth at 3 o’clock',
  });
});

test('the mapped row satisfies the engine input contract', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Source Key NEW': 'new:42',
    'Log Dist NEW (m)': 123.45,
    'Depth NEW (%WT)': 35,
    'Length NEW (mm)': 120,
    'Width NEW (mm)': 45,
    'Wall WT NEW (mm)': 12.7,
    'Depth Growth (%WT/yr)': 1.5,
    'Length Growth (mm/yr)': 4,
  }], engineering, '77', released('new:42'));

  // Guards the operating-pressure key, which was previously written mojibake
  // and silently failed validation on every alignment import.
  for (const column of REQUIRED_COLUMNS) {
    assert.ok(column in mapped.accepted[0].row, `mapped row is missing "${column}"`);
  }
  assert.deepEqual(validateData([mapped.accepted[0].row]), []);
});

test('only features released by Corrosion Analysis are assessed', () => {
  const rows = [
    {
      'Source Key NEW': 'new:1',
      'Identif. NEW': 'A-1',
      'Log Dist NEW (m)': 10,
      'Depth NEW (%WT)': 25,
      'Length NEW (mm)': 50,
      'Width NEW (mm)': 20,
      'Wall WT NEW (mm)': 10,
    },
    {
      'Source Key NEW': 'new:2',
      'Identif. NEW': 'A-2',
      'Log Dist NEW (m)': 20,
      'Depth NEW (%WT)': 30,
      'Length NEW (mm)': 60,
      'Width NEW (mm)': 25,
      'Wall WT NEW (mm)': 10,
    },
  ];

  const mapped = mapAlignmentRowsToFfs(rows, engineering, '5', released('new:2'));

  assert.deepEqual(mapped.accepted.map((item) => item.provenance.sourceFeatureKey), ['new:2']);
  assert.deepEqual(mapped.rejected, [{ featureId: 'A-1', reason: 'Not selected in Corrosion Analysis.' }]);
});

test('an assessment without a saved selection is refused outright', () => {
  assert.throws(
    () => mapAlignmentRowsToFfs([], engineering, '5', undefined as never),
    /Corrosion Analysis selection is required/i,
  );
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
  }, '9', released('new:7'));

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
  ], engineering, '10', released('new:2'));

  assert.equal(mapped.accepted.length, 0);
  assert.equal(mapped.rejected.length, 2);
  assert.match(mapped.rejected[0].reason, /NEW-run feature/i);
  assert.match(mapped.rejected[1].reason, /Length NEW/);
});

test('explains every condition that keeps the assessment disabled', () => {
  assert.deepEqual(getAlignmentImportReadiness({
    lineName: 'HU CPA',
    iliDate: '1998-07-03',
    selectedRunId: '12',
    alignmentRowCount: 0,
    selectedFeatureCount: 0,
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

test('a loaded session with no released feature blocks the assessment', () => {
  assert.deepEqual(getAlignmentImportReadiness({
    lineName: 'HU CPA',
    iliDate: '2026-07-03',
    selectedRunId: '12',
    alignmentRowCount: 1_200,
    selectedFeatureCount: 0,
    outerDiameterMm: '508',
    smysMpa: '359',
    designFactor: '0.72',
    operatingPressureMpa: '7.2',
    fallbackDepthGrowthMmPerYear: '0',
    fallbackLengthGrowthMmPerYear: '0',
  }), ['Release at least one feature in Corrosion Analysis for this session.']);
});
