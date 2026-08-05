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
    'Match/Unmatch': 'Matched',
    'Source Key OLD': 'old:42',
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
    'Feature ID': 'A-42',
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
    'Design Factor Source': 'line-default',
    'Safety Factor': '',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '7.2',
    'Clustered Metal Loss': 'No',
    // The run in this fixture reported no joint columns, so they arrive blank
    // rather than as a zero that would read as "at the girth weld".
    'Joint No.': '',
    'Dist U/S GW [m]': '',
    'Joint Length [m]': '',
    'Repair Status': 'Unrepaired',
    'Repair Method': '',
    'Repair Date': '',
    'Repair Reference': '',
    Recommendation: '',
    'Action Owner': '',
  });
  assert.deepEqual(mapped.accepted[0].provenance, {
    alignmentSessionId: '77',
    sourceFeatureKey: 'new:42',
    featureId: 'A-42',
    section: 'KP 0-5',
    designFactor: 0.72,
    designFactorSource: 'line-default',
    isClusteredMetalLoss: false,
    growthEvidence: {
      oldSurveyYear: null,
      newSurveyYear: null,
      intervalYears: null,
      depth: {
        observation: 'matched-measured',
        analysisBasis: 'reported',
        rawRateMmPerYear: 0.1905,
        analysisRateMmPerYear: 0.1905,
        formula: '1.5 %WT/y x 12.7 mm / 100',
        note: 'Run-pair depth growth reported by the alignment engine.',
      },
      length: {
        observation: 'matched-measured',
        analysisBasis: 'reported',
        rawRateMmPerYear: 4,
        analysisRateMmPerYear: 4,
        formula: null,
        note: 'Run-pair length growth reported by the alignment engine.',
      },
    },
    selectionReason: 'Active growth at 3 o’clock',
  });
});

test('the mapped row satisfies the engine input contract', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Match/Unmatch': 'Matched',
    'Source Key OLD': 'old:42',
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

test('estimates NEW-only depth CGR from a disclosed zero baseline and survey interval', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Match/Unmatch': 'Only NEW',
    'Source Key OLD': '-',
    'Source Key NEW': 'new:40',
    'Identif. NEW': 'NEW-40',
    'Run Year OLD': 2020,
    'Run Year NEW': 2024,
    'Log Dist NEW (m)': 3915.603,
    'Depth NEW (%WT)': 40,
    'Length NEW (mm)': 161,
    'Width NEW (mm)': 45,
    'Wall WT NEW (mm)': 10,
  }], engineering, 'new-case', released('new:40'));

  assert.equal(mapped.accepted[0].row['CR Depth [mm/y]'], '1');
  assert.deepEqual(mapped.accepted[0].provenance.growthEvidence.depth, {
    observation: 'new-only-zero-baseline-estimate',
    analysisBasis: 'estimated',
    rawRateMmPerYear: null,
    analysisRateMmPerYear: 1,
    formula: '(40 / 100 x 10 mm - 0 mm) / (2024 - 2020) y',
    note: 'Estimated from an assumed zero-depth baseline at the OLD survey; not a measured run-pair CGR.',
  });
  assert.equal(mapped.accepted[0].provenance.growthEvidence.intervalYears, 4);
  assert.match(mapped.accepted[0].warnings.join(' '), /zero-depth baseline/i);
});

test('NEW-only classification overrides a stale zero in the pair-growth column', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Match/Unmatch': 'Only NEW',
    'Source Key OLD': '-',
    'Source Key NEW': 'new:stale-zero',
    'Run Year OLD': 2020,
    'Run Year NEW': 2024,
    'Log Dist NEW (m)': 12,
    'Depth NEW (%WT)': 40,
    'Length NEW (mm)': 80,
    'Width NEW (mm)': 20,
    'Wall WT NEW (mm)': 10,
    'Depth Growth (%WT/yr)': 0,
  }], engineering, 'stale-zero', released('new:stale-zero'));

  assert.equal(mapped.accepted[0].row['CR Depth [mm/y]'], '1');
  assert.equal(mapped.accepted[0].provenance.growthEvidence.depth.analysisBasis, 'estimated');
});

test('does not invent a NEW-only CGR when the survey interval is missing', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Match/Unmatch': 'Only NEW',
    'Source Key OLD': '-',
    'Source Key NEW': 'new:no-year',
    'Log Dist NEW (m)': 10,
    'Depth NEW (%WT)': 40,
    'Length NEW (mm)': 80,
    'Width NEW (mm)': 20,
    'Wall WT NEW (mm)': 10,
  }], engineering, 'missing-year', released('new:no-year'));

  assert.equal(mapped.accepted[0].row['CR Depth [mm/y]'], '0');
  assert.deepEqual(mapped.accepted[0].provenance.growthEvidence.depth, {
    observation: 'unavailable',
    analysisBasis: 'none',
    rawRateMmPerYear: null,
    analysisRateMmPerYear: null,
    formula: null,
    note: 'NEW-only depth CGR cannot be estimated because a valid OLD-to-NEW survey interval is unavailable.',
  });
  assert.match(mapped.accepted[0].warnings.join(' '), /cannot be calculated/i);
});

test('preserves an apparent depth decrease and does not relabel it as zero growth', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Match/Unmatch': 'Matched',
    'Source Key OLD': 'old:decrease',
    'Source Key NEW': 'new:decrease',
    'Run Year OLD': 2020,
    'Run Year NEW': 2024,
    'Log Dist NEW (m)': 20,
    'Depth NEW (%WT)': 30,
    'Length NEW (mm)': 100,
    'Width NEW (mm)': 30,
    'Wall WT NEW (mm)': 10,
    'Depth Growth (%WT/yr)': -2,
    'Length Growth (mm/yr)': -1,
  }], engineering, 'decrease', released('new:decrease'));

  assert.equal(mapped.accepted[0].row['CR Depth [mm/y]'], '0');
  assert.deepEqual(mapped.accepted[0].provenance.growthEvidence.depth, {
    observation: 'apparent-decrease',
    analysisBasis: 'none',
    rawRateMmPerYear: -0.2,
    analysisRateMmPerYear: null,
    formula: '-2 %WT/y x 10 mm / 100',
    note: 'The matched run pair reports an apparent depth decrease; review sizing uncertainty before assigning a projection rate.',
  });
  assert.match(mapped.accepted[0].warnings.join(' '), /apparent depth decrease/i);
});

test('does not apply the zero baseline to a matched feature whose CGR is missing', () => {
  const mapped = mapAlignmentRowsToFfs([{
    'Match/Unmatch': 'Matched',
    'Source Key OLD': 'old:missing-rate',
    'Source Key NEW': 'new:missing-rate',
    'Run Year OLD': 2020,
    'Run Year NEW': 2024,
    'Log Dist NEW (m)': 30,
    'Depth NEW (%WT)': 40,
    'Length NEW (mm)': 100,
    'Width NEW (mm)': 30,
    'Wall WT NEW (mm)': 10,
  }], engineering, 'matched-missing', released('new:missing-rate'));

  assert.equal(mapped.accepted[0].row['CR Depth [mm/y]'], '0');
  assert.equal(mapped.accepted[0].provenance.growthEvidence.depth.observation, 'unavailable');
  assert.equal(mapped.accepted[0].provenance.growthEvidence.depth.analysisBasis, 'none');
  assert.match(mapped.accepted[0].provenance.growthEvidence.depth.note, /matched run-pair CGR is unavailable/i);
});
