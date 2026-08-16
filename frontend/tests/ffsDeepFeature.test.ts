/**
 * A feature deeper than the 80 %WT project rejection line has to survive the
 * whole path and arrive in the report as a failure — not disappear on the way.
 *
 * Three separate gates used to drop it: the corrosion handoff refused to mark it
 * FFS-ready, the alignment import rejected it as outside the supported domain,
 * and the row validator raised an error that `assertValidFfsRow` throws on, so a
 * single deep anomaly aborted the entire assessment. Between them the deepest
 * metal loss on a line — the features most likely to govern the disposition —
 * could not reach the engine at all, while the engine itself had handled them
 * correctly the whole time.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { processAllRows, processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { validateData } from '../src/lib/ffs/validation.ts';
import { applicabilityChecks, applicabilityStatus } from '../src/lib/ffs/assessmentProfile.ts';
import { toCorrosionFeature } from '../src/lib/corrosion/analysis.ts';
import { mapAlignmentRowsToFfs, type AlignmentEngineeringInputs } from '../src/lib/ffs/alignmentImport.ts';
import { DEFAULT_SCREENING_CONFIG, REQUIRED_COLUMNS, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Deep feature line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23T00:00:00.000Z'),
  highlightYears: 5,
};

function row(overrides: Record<string, string> = {}) {
  return {
    ['LD [m]']: '100',
    ['Section']: 'Joint-1',
    ['Surface']: 'External',
    ['Max Depth [%]']: '85',
    ['Length [mm]']: '100',
    ['Width [mm]']: '30',
    ['Orient. (hrs:mins)']: '6:00',
    ['Nominal Wall Thickness [mm]']: '10',
    ['CR Depth [mm/y]']: '0.2',
    ['CR Length [mm/y]']: '0',
    ['Design Factor']: '0.72',
    ['Outer Diameter Ds']: '500',
    ['SMYS [MPa]']: '400',
    ['Operating Pressure P₀ [MPa]']: '5',
    ...overrides,
  };
}

test('a feature past 80 %WT validates instead of aborting the assessment', () => {
  assert.deepEqual(validateData([row()]), []);
});

test('metal loss that leaves no wall to assess is still refused', () => {
  const errors = validateData([row({ ['Max Depth [%]']: '101' })]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].col, 'Max Depth [%]');
  assert.match(errors[0].msg, /100/);
});

test('one deep feature no longer takes the whole population down with it', async () => {
  const results = await processAllRows(
    [row({ ['Max Depth [%]']: '30' }), row({ ['Max Depth [%]']: '85' })],
    config,
  );
  assert.equal(results.length, 2);
});

test('the deep feature is assessed, fails, and is flagged as outside the depth line', () => {
  const result = processRow(row(), config);
  const [screened] = screenResults([result], config, DEFAULT_SCREENING_CONFIG);

  assert.equal(result.acceptance, 'Un-Acceptable');
  assert.equal(screened.conservative.beyondDepthLimit, true);
  assert.equal(screened.conservative.severity, 'fail');
  assert.equal(screened.priority, 'High');
  // Already past the line at the ILI date, so there is no life left to project.
  assert.equal(result.remnantLife.years, 0);
  assert.equal(result.remnantLife.governingLimit, 'Depth = 80%');
});

test('the applicability check raises it for review rather than calling it inapplicable', () => {
  const [screened] = screenResults([processRow(row(), config)], config, DEFAULT_SCREENING_CONFIG);
  const depthCheck = applicabilityChecks(screened).find((check) => check.id === 'depth-domain')!;

  assert.equal(depthCheck.status, 'review');
  assert.match(depthCheck.detail, /1\.2\(f\)/);
  // 'outside-domain' is reserved for geometry the calculation cannot run on.
  assert.equal(applicabilityStatus(screened), 'limited');
});

test('the corrosion handoff no longer withholds the deepest features from FFS', () => {
  const feature = toCorrosionFeature({
    'Source Key NEW': 'new:1',
    'Log Dist NEW (m)': 658,
    'Depth NEW (%WT)': 85,
    'Length NEW (mm)': 31,
    'Width NEW (mm)': 99,
    'Wall WT NEW (mm)': 9.3,
  } as never);

  assert.ok(feature !== null);
  assert.deepEqual(feature!.blockers, []);
  assert.equal(feature!.ffsReady, true);
});

test('the alignment import carries the deep feature through and discloses why', () => {
  const engineering: AlignmentEngineeringInputs = {
    outerDiameterMm: 219.1,
    smysMpa: 290,
    designFactor: 0.72,
    operatingPressureMpa: 9.35,
    fallbackDepthGrowthMmPerYear: 0,
    fallbackLengthGrowthMmPerYear: 0,
    sectionDesignFactors: [],
  };
  const alignmentRow = (depth: number) => ({
    'Match/Unmatch': 'Matched',
    'Source Key OLD': 'old:1',
    'Source Key NEW': 'new:1',
    'Identif. NEW': 'A-1',
    'Log Dist NEW (m)': 658.019,
    'Section NEW': 'Buried Section',
    'Surface NEW': 'External',
    'Depth NEW (%WT)': depth,
    'Length NEW (mm)': 31,
    'Width NEW (mm)': 99,
    "O'Clock NEW": '09:44',
    'Wall WT NEW (mm)': 9.3,
    'Run Year OLD': 2012,
    'Run Year NEW': 2024,
    'Depth Growth (%WT/yr)': 1.2,
    'Length Growth (mm/yr)': 0.5,
  });

  const mapped = mapAlignmentRowsToFfs(
    [alignmentRow(85) as never],
    engineering,
    'session-1',
    { selectedKeys: new Set(['new:1']) },
  );

  assert.equal(mapped.rejected.length, 0);
  assert.equal(mapped.accepted.length, 1);
  assert.ok(
    mapped.accepted[0].warnings.some((warning) => /80 %WT/.test(warning)),
    'a feature past the rejection line must arrive carrying its disclosure',
  );

  // Through-wall is still refused: there is nothing left to assess.
  const throughWall = mapAlignmentRowsToFfs(
    [alignmentRow(101) as never],
    engineering,
    'session-1',
    { selectedKeys: new Set(['new:1']) },
  );
  assert.equal(throughWall.accepted.length, 0);
  assert.equal(throughWall.rejected.length, 1);
});
