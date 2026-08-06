import assert from 'node:assert/strict';
import test from 'node:test';

import { RECOMMENDED_TOLERANCES, type ToleranceValues } from '../src/wizard/matchingRules.ts';
import {
  buildProjectionColumns,
  formatHours,
  formatSignedPercent,
  matchProfile,
  percentDelta,
  projectionInputFrom,
  projectMatchOutcome,
  sameTolerances,
  scaleTolerances,
  SPEC_BY_KEY,
  TOLERANCE_SPECS,
} from '../src/wizard/toleranceModel.ts';

const INPUT = { oldAnomalies: 1305, newAnomalies: 10860 };

test('every spec keeps its floor above zero', () => {
  // A zero-width gate rejects every pair that is not an exact reading match,
  // which empties the match table without any warning to the engineer.
  for (const spec of TOLERANCE_SPECS) {
    assert.ok(spec.min > 0, `${spec.key} must not allow 0`);
    assert.ok(spec.max > spec.min, `${spec.key} range must be ordered`);
  }
});

test('loosening any single gate can only add candidate pairs', () => {
  const base = projectMatchOutcome(RECOMMENDED_TOLERANCES, INPUT);
  for (const spec of TOLERANCE_SPECS) {
    const looser: ToleranceValues = {
      ...RECOMMENDED_TOLERANCES,
      [spec.key]: Math.min(spec.max, RECOMMENDED_TOLERANCES[spec.key] * 1.5),
    };
    const projected = projectMatchOutcome(looser, INPUT);
    assert.ok(
      projected.candidatePairs >= base.candidatePairs,
      `${spec.key}: expected >= ${base.candidatePairs}, got ${projected.candidatePairs}`,
    );
    assert.ok(
      projected.confidence <= base.confidence,
      `${spec.key}: looser gates must not raise confidence`,
    );
  }
});

test('review time tracks the candidate pair count', () => {
  const projection = projectMatchOutcome(RECOMMENDED_TOLERANCES, INPUT);
  const expected = (projection.candidatePairs * 3.5) / 3600;
  assert.ok(Math.abs(projection.reviewHours - expected) < 1e-9);
});

test('assumptions scale the projection they describe', () => {
  const base = projectMatchOutcome(RECOMMENDED_TOLERANCES, INPUT, {
    neighbourhood: 4,
    secondsPerPair: 3.5,
  });
  const doubled = projectMatchOutcome(RECOMMENDED_TOLERANCES, INPUT, {
    neighbourhood: 8,
    secondsPerPair: 3.5,
  });
  // Both counts are rounded independently, so allow the one-pair gap that
  // doubling a rounded value cannot avoid.
  assert.ok(Math.abs(doubled.candidatePairs - base.candidatePairs * 2) <= 1);

  const slower = projectMatchOutcome(RECOMMENDED_TOLERANCES, INPUT, {
    neighbourhood: 4,
    secondsPerPair: 7,
  });
  assert.ok(Math.abs(slower.reviewHours - base.reviewHours * 2) < 1e-9);
  assert.equal(slower.candidatePairs, base.candidatePairs);
});

test('a disabled upstream gate stops removing candidates', () => {
  const gated = projectMatchOutcome(RECOMMENDED_TOLERANCES, INPUT);
  const ungated = projectMatchOutcome(
    { ...RECOMMENDED_TOLERANCES, use_us_gw_distance: false },
    INPUT,
  );
  assert.ok(ungated.candidatePairs > gated.candidatePairs);
});

test('confidence stays inside the reportable band', () => {
  const tightest = projectMatchOutcome(
    Object.fromEntries([
      ...TOLERANCE_SPECS.map((spec) => [spec.key, spec.min]),
      ['use_us_gw_distance', true],
    ]) as unknown as ToleranceValues,
    INPUT,
  );
  const loosest = projectMatchOutcome(
    Object.fromEntries([
      ...TOLERANCE_SPECS.map((spec) => [spec.key, spec.max]),
      ['use_us_gw_distance', true],
    ]) as unknown as ToleranceValues,
    INPUT,
  );
  for (const projection of [tightest, loosest]) {
    assert.ok(projection.confidence >= 55 && projection.confidence <= 99);
  }
  assert.ok(tightest.confidence > loosest.confidence);
});

test('scaling clamps to each spec instead of leaving the track', () => {
  const tiny = scaleTolerances(RECOMMENDED_TOLERANCES, 0.001);
  const huge = scaleTolerances(RECOMMENDED_TOLERANCES, 1000);
  for (const spec of TOLERANCE_SPECS) {
    assert.equal(tiny[spec.key], spec.min, `${spec.key} floor`);
    assert.equal(huge[spec.key], spec.max, `${spec.key} ceiling`);
  }
});

test('scaling lands on clean step values', () => {
  const scaled = scaleTolerances(RECOMMENDED_TOLERANCES, 0.6);
  assert.equal(scaled.clock_tolerance, 9);
  assert.equal(scaled.length_tolerance, 30);
  // 0.2 * 0.6 = 0.12, snapped to the 0.05 step.
  assert.equal(scaled.us_gw_distance_tolerance, 0.1);
});

test('scaling never touches the upstream gate switch', () => {
  const off: ToleranceValues = { ...RECOMMENDED_TOLERANCES, use_us_gw_distance: false };
  assert.equal(scaleTolerances(off, 0.6).use_us_gw_distance, false);
});

test('the three projection columns are ordered by yield', () => {
  const columns = buildProjectionColumns(RECOMMENDED_TOLERANCES, INPUT);
  const [stricter, current, looser] = columns;
  assert.equal(stricter.id, 'stricter');
  assert.equal(current.id, 'current');
  assert.equal(looser.id, 'looser');
  assert.ok(stricter.projection.candidatePairs < current.projection.candidatePairs);
  assert.ok(current.projection.candidatePairs < looser.projection.candidatePairs);
  assert.ok(stricter.projection.confidence > looser.projection.confidence);
});

test('the current column reports the values passed in, unscaled', () => {
  const columns = buildProjectionColumns(RECOMMENDED_TOLERANCES, INPUT);
  const current = columns.find((column) => column.id === 'current');
  assert.deepEqual(current?.values, RECOMMENDED_TOLERANCES);
});

test('profiles round-trip through matchProfile', () => {
  assert.equal(matchProfile(RECOMMENDED_TOLERANCES)?.id, 'default');
  assert.equal(matchProfile({ ...RECOMMENDED_TOLERANCES, clock_tolerance: 21 }), null);
});

test('sameTolerances ignores keys outside the engine contract', () => {
  assert.ok(sameTolerances(RECOMMENDED_TOLERANCES, { ...RECOMMENDED_TOLERANCES }));
  assert.ok(!sameTolerances(RECOMMENDED_TOLERANCES, {
    ...RECOMMENDED_TOLERANCES,
    use_us_gw_distance: false,
  }));
});

test('projection input is refused when intake has not produced counts', () => {
  assert.equal(projectionInputFrom(undefined), null);
  assert.equal(projectionInputFrom({ oldRun: { anomalies: 0 }, newRun: { anomalies: 10 } }), null);
  assert.deepEqual(
    projectionInputFrom({ oldRun: { anomalies: 12 }, newRun: { anomalies: 30 } }),
    { oldAnomalies: 12, newAnomalies: 30 },
  );
});

test('projection input falls back to the master run label', () => {
  assert.deepEqual(
    projectionInputFrom({ oldRun: { anomalies: 5 }, masterRun: { anomalies: 9 } }),
    { oldAnomalies: 5, newAnomalies: 9 },
  );
});

test('formatters render the shapes the panel expects', () => {
  assert.equal(formatHours(0.04), '<0.1 h');
  assert.equal(formatHours(3.62), '~3.6 h');
  assert.equal(formatHours(41.2), '~41 h');
  assert.equal(formatSignedPercent(61.6), '+62%');
  assert.equal(formatSignedPercent(-33.7), '-34%');
  assert.equal(percentDelta(5, 0), null);
});

test('spec lookup covers every rendered control', () => {
  for (const spec of TOLERANCE_SPECS) {
    assert.equal(SPEC_BY_KEY[spec.key], spec);
  }
});
