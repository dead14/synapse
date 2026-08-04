/**
 * The TypeScript half of the B31G cross-implementation pin.
 *
 * The corrosion assessment report is generated in Python; the FFS module
 * calculates in TypeScript. Two implementations of one standard drift unless
 * something holds them together, so both read the *same* vector file —
 * `backend/tests/b31g_golden_vectors.json` — rather than each carrying its own
 * transcribed copy. A hand-copied pin only pins the halves to whatever was
 * typed, which is how the previous version of this test ended up asserting
 * `SMYS + 69` against an engine that had moved to the converted 10 ksi uplift.
 *
 * The fixture is generated from this engine. This half therefore asserts the
 * fixture still describes the engine; `backend/tests/test_b31g_parity.py`
 * asserts the Python port reproduces it. Regenerate both together or neither.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import type { FfsConfig } from '../src/lib/ffs/types.ts';

interface GoldenVector {
  id: string;
  input: {
    method: 'original' | 'modified';
    saMode: 'smys69' | 'smys11';
    depthPct: number;
    lengthMm: number;
    wallMm: number;
    odMm: number;
    smysMpa: number;
    designFactor: number;
    pressureMpa: number;
    crDepthMmPerYear: number;
    crLengthMmPerYear: number;
    safetyFactor: number | null;
  };
  expected: Record<string, number | string | null>;
}

const fixturePath = fileURLToPath(new URL('../../backend/tests/b31g_golden_vectors.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  tolerance: number;
  vectors: GoldenVector[];
};

const NUMERIC_KEYS = ['so', 'z', 'sflow', 'Sf', 'Pf', 'safePressure', 'ERF', 'safetyFactor'] as const;

function near(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= fixture.tolerance,
    `${label}: ${actual} !== ${expected}`,
  );
}

test('the golden-vector fixture is not empty and covers both safety-factor provenances', () => {
  assert.ok(fixture.vectors.length >= 8);
  const sources = new Set(fixture.vectors.map((v) => v.expected.safetyFactorSource));
  assert.ok(sources.has('explicit'), 'the para. 1.9 ratio must be pinned, not only the 1/F fallback');
  assert.ok(sources.has('derived-from-design-factor'));
});

for (const vector of fixture.vectors) {
  test(`B31G parity vector ${vector.id}`, () => {
    const { input, expected } = vector;
    const config: FfsConfig = {
      lineName: 'PARITY',
      method: input.method,
      modifiedSa: input.saMode,
      iliDate: new Date('2026-01-01T00:00:00Z'),
      highlightYears: 5,
    };

    const result = processRow({
      'LD [m]': '1.0',
      Section: 'S1',
      Surface: 'External',
      'Max Depth [%]': String(input.depthPct),
      'Length [mm]': String(input.lengthMm),
      'Width [mm]': '40',
      'Orient. (hrs:mins)': '6:00',
      'Nominal Wall Thickness [mm]': String(input.wallMm),
      'CR Depth [mm/y]': String(input.crDepthMmPerYear),
      'CR Length [mm/y]': String(input.crLengthMmPerYear),
      'Design Factor': String(input.designFactor),
      'Outer Diameter Ds': String(input.odMm),
      'SMYS [MPa]': String(input.smysMpa),
      'Operating Pressure P₀ [MPa]': String(input.pressureMpa),
      'Safety Factor': input.safetyFactor === null ? '' : String(input.safetyFactor),
    }, config);

    const actual: Record<string, number | string | null> = {
      so: result.So,
      z: result.z,
      M: result.M,
      sflow: result.sflow,
      Sf: result.Sf,
      Pf: result.Pf,
      safePressure: result.safePressure,
      ERF: result.ERF,
      branch: result.branch,
      safetyFactor: result.SF,
      safetyFactorSource: result.safetyFactorSource,
      years: result.remnantLife.years,
      status: result.remnantLife.status,
      governingLimit: result.remnantLife.governingLimit,
      depthLimitYears: result.remnantLife.depthLimitYears,
      erfLimitYears: result.remnantLife.erfLimitYears,
    };

    for (const key of NUMERIC_KEYS) {
      near(actual[key] as number, expected[key] as number, key);
    }
    if (expected.M === null) assert.equal(actual.M, null);
    else near(actual.M as number, expected.M as number, 'M');

    assert.equal(actual.branch, expected.branch);
    assert.equal(actual.safetyFactorSource, expected.safetyFactorSource);
    assert.equal(actual.status, expected.status);
    assert.equal(actual.governingLimit, expected.governingLimit);

    for (const key of ['years', 'depthLimitYears', 'erfLimitYears'] as const) {
      if (expected[key] === null) assert.equal(actual[key], null, key);
      else near(actual[key] as number, expected[key] as number, key);
    }
  });
}

/**
 * The safety factor is the whole reason the two implementations diverged in the
 * first place, so it gets its own assertion rather than only riding along in the
 * vectors: the same pit under two different para. 1.9 ratios must move the safe
 * pressure and the ERF, and must not touch the failure pressure.
 */
test('the para. 1.9 safety factor moves the safe pressure, not the failure pressure', () => {
  const at = (sf: string) => fixture.vectors.find((v) => v.id === `mod69-explicit-sf-${sf}`)!.expected;
  const lenient = at('125');
  const strict = at('139');

  assert.equal(lenient.Pf, strict.Pf);
  assert.ok((strict.safePressure as number) < (lenient.safePressure as number));
  assert.ok((strict.ERF as number) > (lenient.ERF as number));
});
