import test from 'node:test';
import assert from 'node:assert/strict';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import {
  buildScenarioForecastComparison,
  createScenarioSnapshot,
  loadScenarioSnapshots,
  scenarioSnapshotsWorkbook,
  saveScenarioSnapshots,
} from '../src/lib/ffs/scenarioArtifacts.ts';
import { evaluateFfsScenario, scenarioInputsForPreset } from '../src/lib/ffs/scenarioLab.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Scenario artifact line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-01-01'),
  highlightYears: 5,
  analysisHorizonYears: 30,
  pressureBasis: 'current-operating',
};

const screening = {
  ...DEFAULT_SCREENING_CONFIG,
  depthTolerancePct: 10,
  lengthToleranceMm: 10,
  forecastYears: 5,
};

function nominal() {
  return processRow({
    'LD [m]': '100',
    Section: 'Sec A',
    Surface: 'External',
    'Max Depth [%]': '40',
    'Length [mm]': '50',
    'Width [mm]': '80',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '1',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '390',
    'Operating Pressure P₀ [MPa]': '9.46',
  }, config);
}

test('forecast comparison uses bounded year offsets for reported, conservative, and draft cases', () => {
  const result = nominal();
  const draftInputs = {
    ...scenarioInputsForPreset('forecast', result, screening),
    requiredPressureMpa: result.p0 * 1.1,
  };
  const comparison = buildScenarioForecastComparison(result, config, screening, draftInputs);

  assert.deepEqual(comparison.map((series) => series.id), ['as-reported', 'conservative', 'draft']);
  assert.equal(comparison[0].points[0].yearOffset, 0);
  assert.equal(comparison[0].points.at(-1)?.yearOffset, 5);
  assert.ok(comparison.every((series) => series.points.every((point) => (
    point.yearOffset >= 0 && point.yearOffset <= result.analysisHorizonYears
  ))));
  assert.ok(comparison.every((series) => series.points.every((point) => !('date' in point))));
  assert.ok(comparison[2].points[0].erf > comparison[1].points[0].erf);
});

test('scenario snapshot records provenance and can be exported without changing the official result', () => {
  const result = nominal();
  const inputs = scenarioInputsForPreset('forecast', result, screening);
  const evaluation = evaluateFfsScenario(result, config, screening, inputs);
  const snapshot = createScenarioSnapshot({
    id: 'scenario-1',
    featureKey: 'feature-100',
    featureId: 'ML-100',
    author: 'engineer@example.com',
    reason: 'Pressure review before integrity meeting',
    createdAtIso: '2026-08-03T08:00:00.000Z',
    inputs,
    evaluation,
    nominal: result,
    config,
  });
  const workbook = scenarioSnapshotsWorkbook([snapshot]);
  const sheet = workbook.Sheets['Scenario snapshots'];
  const rows = sheet ? Object.values(sheet).map((cell) => cell?.v) : [];

  assert.equal(snapshot.author, 'engineer@example.com');
  assert.equal(snapshot.reason, 'Pressure review before integrity meeting');
  assert.equal(snapshot.official.erf, result.ERF);
  assert.equal(result.p0, 9.46);
  assert.ok(rows.includes('engineer@example.com'));
  assert.ok(rows.includes('Pressure review before integrity meeting'));
});

test('session snapshot storage rejects corrupt records and round-trips valid snapshots', () => {
  const state = new Map<string, string>();
  const storage = {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => { state.set(key, value); },
  };
  const result = nominal();
  const inputs = scenarioInputsForPreset('as-reported', result, screening);
  const snapshot = createScenarioSnapshot({
    id: 'scenario-2',
    featureKey: 'feature-100',
    featureId: null,
    author: 'Engineer One',
    reason: 'Baseline for comparison',
    createdAtIso: '2026-08-03T08:05:00.000Z',
    inputs,
    evaluation: evaluateFfsScenario(result, config, screening, inputs),
    nominal: result,
    config,
  });

  saveScenarioSnapshots(storage, 'feature-100', [snapshot]);
  assert.deepEqual(loadScenarioSnapshots(storage, 'feature-100'), [snapshot]);

  state.set('synapse.ffs.scenarios.feature-100', '{bad json');
  assert.deepEqual(loadScenarioSnapshots(storage, 'feature-100'), []);
});

test('snapshot requires auditable author, reason, and timestamp', () => {
  const result = nominal();
  const inputs = scenarioInputsForPreset('as-reported', result, screening);
  const evaluation = evaluateFfsScenario(result, config, screening, inputs);

  assert.throws(() => createScenarioSnapshot({
    id: 'scenario-3', featureKey: 'feature-100', featureId: null,
    author: '', reason: '', createdAtIso: 'not-a-date', inputs, evaluation, nominal: result, config,
  }), /author/i);
});
