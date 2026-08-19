import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { buildCalcTrace, verifyCalcTrace } from '../src/lib/ffs/calcTrace.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Trace test line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-01-01T00:00:00.000Z'),
  highlightYears: 10,
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'LD [m]': '1200',
    Section: 'S-01',
    Surface: 'External',
    'Max Depth [%]': '45',
    'Length [mm]': '120',
    'Width [mm]': '60',
    'Orient. (hrs:mins)': '06:00',
    'Nominal Wall Thickness [mm]': '9.53',
    'CR Depth [mm/y]': '0.10',
    'CR Length [mm/y]': '1.5',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '6.0',
    ...overrides,
  };
}

/**
 * The regression this module exists for. With an explicit para. 1.9 safety
 * factor the old trace printed `P_safe = P_F × DF` and `ERF = S₀ / (S_F × DF)`,
 * which understated the safe pressure by 10 % and overstated ERF by 11 %
 * relative to the numbers displayed beside them.
 */
test('every printed step reproduces its own result under an explicit safety factor', () => {
  const result = processRow(row({ 'Safety Factor': '1.25' }), config);
  const trace = buildCalcTrace(result, config, DEFAULT_SCREENING_CONFIG);

  assert.equal(result.safetyFactorSource, 'explicit');
  assert.equal(result.SF, 1.25);
  assert.deepEqual(verifyCalcTrace(trace).map((step) => step.id), []);
});

test('every printed step reproduces its own result when SF is derived from the design factor', () => {
  const result = processRow(row(), config);
  const trace = buildCalcTrace(result, config, DEFAULT_SCREENING_CONFIG);

  assert.equal(result.safetyFactorSource, 'derived-from-design-factor');
  assert.deepEqual(verifyCalcTrace(trace).map((step) => step.id), []);
});

test('the trace holds together on every method, stress mode, and branch', () => {
  const cases: { method: FfsConfig['method']; sa: FfsConfig['modifiedSa']; length: string }[] = [
    { method: 'original', sa: 'smys11', length: '120' },   // z <= 20
    { method: 'original', sa: 'smys11', length: '900' },    // z > 20, no Folias term
    { method: 'modified', sa: 'smys69', length: '120' },    // z <= 50
    { method: 'modified', sa: 'smys11', length: '120' },
    { method: 'modified', sa: 'smys69', length: '1800' },   // z > 50, linear Folias
  ];

  for (const { method, sa, length } of cases) {
    for (const safetyFactor of ['', '1.25', '1.39']) {
      const scoped: FfsConfig = { ...config, method, modifiedSa: sa };
      const result = processRow(row({ 'Length [mm]': length, 'Safety Factor': safetyFactor }), scoped);
      const failing = verifyCalcTrace(buildCalcTrace(result, scoped, DEFAULT_SCREENING_CONFIG));
      assert.deepEqual(
        failing.map((step) => `${method}/${sa}/L${length}/SF${safetyFactor || 'derived'}:${step.id}`),
        [],
      );
    }
  }
});

test('the safety-factor step names the provenance it actually used', () => {
  const derived = buildCalcTrace(processRow(row(), config), config, DEFAULT_SCREENING_CONFIG);
  const explicit = buildCalcTrace(
    processRow(row({ 'Safety Factor': '1.25' }), config),
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  const derivedStep = derived.find((step) => step.id === 'safety-factor')!;
  const explicitStep = explicit.find((step) => step.id === 'safety-factor')!;

  assert.match(derivedStep.formula, /1 \/ DF/);
  assert.doesNotMatch(explicitStep.formula, /1 \/ DF/);
  assert.match(explicitStep.formula, /hydrotest/);
});

test('the flow-stress step prints the converted 10 ksi uplift, not a rounded 69', () => {
  const result = processRow(row(), config);
  const step = buildCalcTrace(result, config, DEFAULT_SCREENING_CONFIG)
    .find((entry) => entry.id === 'flow-stress')!;

  assert.match(step.substitution, /68\.9476/);
  assert.equal(step.value, +(359 + 68.94757293168689).toFixed(4));
});

test('the Original long branch reports that no bulging factor applies', () => {
  const scoped: FfsConfig = { ...config, method: 'original', modifiedSa: 'smys11' };
  const result = processRow(row({ 'Length [mm]': '900' }), scoped);
  const step = buildCalcTrace(result, scoped, DEFAULT_SCREENING_CONFIG)
    .find((entry) => entry.id === 'folias')!;

  assert.equal(result.M, null);
  assert.equal(step.value, null);
  assert.equal(step.display, 'n/a');
});

test('the acceptance step agrees with the engine on a feature that fails', () => {
  // Deep and long enough that the safe pressure falls under the required one.
  const result = processRow(
    row({ 'Max Depth [%]': '78', 'Length [mm]': '900', 'Operating Pressure P₀ [MPa]': '9.5' }),
    config,
  );
  const trace = buildCalcTrace(result, config, DEFAULT_SCREENING_CONFIG);
  const step = trace.find((entry) => entry.id === 'acceptance')!;

  assert.equal(result.acceptance, 'Un-Acceptable');
  assert.equal(step.display, 'Not acceptable');
  assert.deepEqual(verifyCalcTrace(trace).map((entry) => entry.id), []);
});
