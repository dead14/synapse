import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFfsSpools,
  buildSpoolProgramme,
  emptySpoolDisposition,
  repairOptionById,
  suggestSpoolDisposition,
} from '../src/lib/ffs/spoolReview.ts';
import { DEFAULT_SCREENING_CONFIG } from '../src/lib/ffs/types.ts';
import type { FfsScreenedResult, FfsScreeningConfig } from '../src/lib/ffs/types.ts';

const SCREENING: FfsScreeningConfig = { ...DEFAULT_SCREENING_CONFIG };

interface FixtureOptions {
  index: number;
  ld: number;
  jointNumber?: string | null;
  usGwDistanceM?: number | null;
  jointLengthM?: number | null;
  depthPct?: number;
  erf?: number;
  conservativeErf?: number;
  lifeYears?: number | null;
  crDepth?: number;
  cluster?: boolean;
  section?: string;
  severity?: 'pass' | 'review' | 'fail';
}

/** Only the fields the spool aggregation reads. */
function feature({
  index,
  ld,
  jointNumber = null,
  usGwDistanceM = null,
  jointLengthM = null,
  depthPct = 20,
  erf = 0.4,
  conservativeErf = 0.5,
  lifeYears = 20,
  crDepth = 0.1,
  cluster = false,
  section = 'KP 0-5',
  severity = 'pass',
}: FixtureOptions): FfsScreenedResult {
  return {
    key: `f-${index}`,
    index,
    nominal: {
      featureId: `A-${index}`,
      ld,
      section,
      surface: 'External',
      maxDepthPct: depthPct,
      length: 100,
      width: 40,
      wall: 12.7,
      od: 508,
      branch: 'z≤50',
      p0: 7.2,
      safePressure: erf > 0 ? 7.2 / erf : 0,
      crDepth,
      crLength: 0,
      ERF: erf,
      acceptance: erf >= 1 ? 'Un-Acceptable' : 'Acceptable',
      isClusteredMetalLoss: cluster,
      jointNumber,
      usGwDistanceM,
      jointLengthM,
      repairStatus: 'unrepaired',
      remnantLife: {
        years: lifeYears,
        governingLimit: lifeYears === null ? null : 'ERF = 1',
        dueDateIso: lifeYears === null ? null : '2040-01-01',
        lengthHeldConstant: false,
        status: lifeYears === null ? 'not-reached-within-horizon' : 'calculated',
      },
      growthEvidence: {
        depth: {
          observation: 'run-pair-measured',
          analysisBasis: 'reported',
          rawRateMmPerYear: crDepth,
          analysisRateMmPerYear: crDepth,
        },
      },
    },
    conservative: { ERF: conservativeErf, severity },
    clockHour: 6,
  } as unknown as FfsScreenedResult;
}

test('a reported joint number groups the whole joint into one spool', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 100, jointNumber: 'J-12', usGwDistanceM: 0.5, jointLengthM: 12 }),
      feature({ index: 1, ld: 104, jointNumber: 'J-12', usGwDistanceM: 4.5 }),
      feature({ index: 2, ld: 120, jointNumber: 'J-13', usGwDistanceM: 1 }),
    ],
    { screening: SCREENING },
  );

  assert.equal(spools.length, 2);
  const joint12 = spools.find((spool) => spool.jointNumber === 'J-12');
  assert.ok(joint12);
  assert.equal(joint12.grouping, 'joint-number');
  assert.equal(joint12.featureCount, 2);
  assert.equal(joint12.usGwLdM, 99.5);
  assert.equal(joint12.dsGwLdM, 111.5);
  assert.equal(joint12.label, 'Joint J-12');
});

test('without a joint number the upstream weld position still separates two joints', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 100, usGwDistanceM: 0.5 }),
      feature({ index: 1, ld: 108, usGwDistanceM: 8.5 }),
      feature({ index: 2, ld: 120, usGwDistanceM: 8.5 }),
    ],
    { screening: SCREENING },
  );

  // The first two share an upstream weld at 99.5 m; the third's is at 111.5 m.
  assert.equal(spools.length, 2);
  assert.deepEqual(
    spools.map((spool) => spool.featureCount).sort(),
    [1, 2],
  );
  assert.ok(spools.every((spool) => spool.grouping === 'upstream-weld'));
});

test('with neither, the group is labelled a section rather than presented as a spool', () => {
  const spools = buildFfsSpools(
    [feature({ index: 0, ld: 100 }), feature({ index: 1, ld: 400 })],
    { screening: SCREENING },
  );

  assert.equal(spools.length, 1);
  assert.equal(spools[0].grouping, 'unassigned');
  assert.ok(spools[0].drivers.some((driver) => driver.includes('not a spool')));
});

test('the spool quotes its worst member, never an average', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 100, jointNumber: 'J-1', erf: 0.4, conservativeErf: 0.5, depthPct: 15, lifeYears: 30 }),
      feature({ index: 1, ld: 102, jointNumber: 'J-1', erf: 1.2, conservativeErf: 1.4, depthPct: 62, lifeYears: 3, severity: 'fail' }),
    ],
    { screening: SCREENING },
  );

  const spool = spools[0];
  assert.equal(spool.worstNominalErf, 1.2);
  assert.equal(spool.worstConservativeErf, 1.4);
  assert.equal(spool.maxDepthPct, 62);
  assert.equal(spool.severity, 'fail');
  assert.equal(spool.governingErf?.index, 1);
  assert.equal(spool.governingLife?.index, 1);
  assert.equal(spool.unacceptableCount, 1);
});

test('the mean corrosion rate counts only the features that carry one', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 100, jointNumber: 'J-1', crDepth: 0.2 }),
      feature({ index: 1, ld: 102, jointNumber: 'J-1', crDepth: 0.4 }),
    ],
    { screening: SCREENING },
  );

  assert.equal(spools[0].growth.meanMmPerYear, 0.30000000000000004);
  assert.equal(spools[0].growth.maxMmPerYear, 0.4);
  assert.equal(spools[0].growth.measuredCount, 2);
  assert.equal(spools[0].growth.unavailableCount, 0);
});

test('clustered records are counted and called out, not silently averaged in', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 100, jointNumber: 'J-1' }),
      feature({ index: 1, ld: 101, jointNumber: 'J-1', cluster: true }),
    ],
    { screening: SCREENING },
  );

  assert.equal(spools[0].clusterCount, 1);
  assert.ok(spools[0].drivers.some((driver) => driver.includes('vendor-merged clusters')));
});

test('spools are ordered worst first so the register reads as a work list', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 100, jointNumber: 'J-1', conservativeErf: 0.3 }),
      feature({ index: 1, ld: 200, jointNumber: 'J-2', conservativeErf: 1.4, severity: 'fail' }),
      feature({ index: 2, ld: 300, jointNumber: 'J-3', conservativeErf: 0.9, severity: 'review' }),
    ],
    { screening: SCREENING },
  );

  assert.deepEqual(spools.map((spool) => spool.jointNumber), ['J-2', 'J-3', 'J-1']);
});

test('a spool past the depth rejection limit is suggested for cut and replace', () => {
  const [spool] = buildFfsSpools(
    [feature({ index: 0, ld: 100, jointNumber: 'J-1', depthPct: 85, erf: 0.6, conservativeErf: 0.7 })],
    { screening: SCREENING },
  );
  const suggestion = suggestSpoolDisposition(spool, SCREENING, 5);
  assert.equal(suggestion.optionId, 'cut-and-replace');
  assert.equal(repairOptionById(suggestion.optionId)?.repairClass, 'permanent');
});

test('a spool that only fails once the ILI tolerance is applied is not sent to the cutting crew', () => {
  const [spool] = buildFfsSpools(
    [feature({ index: 0, ld: 100, jointNumber: 'J-1', depthPct: 40, erf: 0.85, conservativeErf: 1.05 })],
    { screening: SCREENING },
  );
  const suggestion = suggestSpoolDisposition(spool, SCREENING, 5);
  assert.equal(suggestion.optionId, 'composite-wrap');
  assert.ok(suggestion.reason.includes('sizing tolerance'));
});

test('an acceptable spool with life beyond the review threshold needs no action', () => {
  const [spool] = buildFfsSpools(
    [feature({ index: 0, ld: 100, jointNumber: 'J-1', depthPct: 12, erf: 0.3, conservativeErf: 0.35, lifeYears: 25 })],
    { screening: SCREENING },
  );
  assert.equal(suggestSpoolDisposition(spool, SCREENING, 5).optionId, 'no-action');
});

test('a new disposition covers every member of the spool by default', () => {
  const [spool] = buildFfsSpools(
    [
      feature({ index: 3, ld: 100, jointNumber: 'J-1' }),
      feature({ index: 7, ld: 102, jointNumber: 'J-1' }),
    ],
    { screening: SCREENING },
  );
  assert.deepEqual(emptySpoolDisposition(spool).memberIndexes, [3, 7]);
});

test('the programme separates a recommendation from work already done', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 100, jointNumber: 'J-1' }),
      feature({ index: 1, ld: 102, jointNumber: 'J-1' }),
      feature({ index: 2, ld: 200, jointNumber: 'J-2' }),
      feature({ index: 3, ld: 300, jointNumber: 'J-3' }),
    ],
    { screening: SCREENING },
  );
  const recommended = spools.find((spool) => spool.jointNumber === 'J-1')!;
  const repaired = spools.find((spool) => spool.jointNumber === 'J-2')!;
  const programme = buildSpoolProgramme(spools, {
    [recommended.id]: {
      mode: 'recommendation',
      optionId: 'type-b-sleeve',
      owner: 'Integrity',
      justification: null,
      repairKind: 'permanent-repair-verified',
      completedDateIso: null,
      evidenceReference: null,
      memberIndexes: [0, 1],
    },
    [repaired.id]: {
      mode: 'repaired',
      optionId: 'cut-and-replace',
      owner: 'Construction',
      justification: null,
      repairKind: 'permanent-repair-verified',
      completedDateIso: '2026-03-04',
      evidenceReference: 'WO-9912',
      memberIndexes: [2],
    },
  });

  assert.equal(programme.decided, 2);
  assert.equal(programme.undecided, 1);
  assert.equal(programme.recommendedCount, 1);
  assert.equal(programme.repairedCount, 1);
  assert.equal(programme.coveredFeatures, 3);
});

test('a new record covers the whole spool and starts as a recommendation', () => {
  const [spool] = buildFfsSpools(
    [feature({ index: 0, ld: 100, jointNumber: 'J-1' })],
    { screening: SCREENING },
  );
  const empty = emptySpoolDisposition(spool);
  assert.equal(empty.mode, 'recommendation');
  assert.equal(empty.completedDateIso, null);
});

// ── Girth-weld grouping ─────────────────────────────────────────────────────

const LADDER = [
  { id: 'GW-1', ldM: 100 },
  { id: 'GW-2', ldM: 112 },
  { id: 'GW-3', ldM: 124 },
];

test('the weld ladder is what defines a spool, not the section or the joint column', () => {
  const spools = buildFfsSpools(
    [
      // Same section, same missing joint number, but three different joints.
      feature({ index: 0, ld: 104, section: 'KP 0-5' }),
      feature({ index: 1, ld: 110, section: 'KP 0-5' }),
      feature({ index: 2, ld: 118, section: 'KP 0-5' }),
      feature({ index: 3, ld: 130, section: 'KP 0-5' }),
    ],
    { screening: SCREENING, girthWelds: LADDER },
  );

  assert.equal(spools.length, 3);
  const first = spools.find((spool) => spool.usGwId === 'GW-1')!;
  assert.equal(first.grouping, 'girth-weld');
  assert.equal(first.featureCount, 2);
  assert.equal(first.usGwLdM, 100);
  assert.equal(first.dsGwLdM, 112);
  assert.equal(first.lengthM, 12);
  assert.equal(first.label, 'GW GW-1 → GW-2');
});

test('a feature past the last weld keeps its own spool instead of joining the last joint', () => {
  const spools = buildFfsSpools(
    [feature({ index: 0, ld: 118 }), feature({ index: 1, ld: 300 })],
    { screening: SCREENING, girthWelds: LADDER },
  );
  assert.equal(spools.length, 2);
  const trailing = spools.find((spool) => spool.lastFeatureLdM === 300)!;
  assert.equal(trailing.dsGwId, null);
  assert.equal(trailing.usGwId, 'GW-3');
  assert.equal(trailing.label, 'Downstream of GW GW-3');
});

test('a feature upstream of the first weld is reported as such, not dropped', () => {
  const [spool] = buildFfsSpools(
    [feature({ index: 0, ld: 40 })],
    { screening: SCREENING, girthWelds: LADDER },
  );
  assert.equal(spool.usGwId, null);
  assert.equal(spool.dsGwId, 'GW-1');
  assert.equal(spool.label, 'Upstream of GW GW-1');
});

test('the ladder beats the vendor joint column where the two disagree', () => {
  const spools = buildFfsSpools(
    [
      feature({ index: 0, ld: 104, jointNumber: 'J-99' }),
      feature({ index: 1, ld: 118, jointNumber: 'J-99' }),
    ],
    { screening: SCREENING, girthWelds: LADDER },
  );
  // One joint number, two welds apart: the welds are measured, the column is not.
  assert.equal(spools.length, 2);
  assert.ok(spools.every((spool) => spool.grouping === 'girth-weld'));
});

test('the spool totals the metal loss it carries', () => {
  const spools = buildFfsSpools(
    [feature({ index: 0, ld: 104 }), feature({ index: 1, ld: 108 })],
    { screening: SCREENING, girthWelds: LADDER },
  );
  const spool = spools[0];
  // Two fixture features of 100 x 40 mm on a 12 m joint.
  assert.equal(spool.featureCount, 2);
  assert.equal(spool.totalMetalLossLengthMm, 200);
  assert.equal(spool.totalMetalLossAreaMm2, 8000);
  assert.ok(Math.abs((spool.metalLossCoveragePct ?? 0) - (200 / 12000) * 100) < 1e-9);
  assert.ok(spool.drivers.some((driver) => driver.includes('metal-loss record')));
});
