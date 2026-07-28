import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSectionBoundaries,
  sectionBoundaryForFeature,
} from '../src/sectioning/sectionBoundaries.ts';
import type { SpatialFeature, SpatialFeatures } from '../src/sectioning/types.ts';
import type { LockedGwPair } from '../src/wizard/matchingSections.ts';

const locks: LockedGwPair[] = [
  { key: 'A', oldId: 'OLD-A', newId: 'NEW-A', oldDistance: 10, newDistance: 12 },
  { key: 'B', oldId: 'OLD-B', newId: 'NEW-B', oldDistance: 20, newDistance: 24 },
];

function feature(overrides: Partial<SpatialFeature>): SpatialFeature {
  return {
    id: 'GW',
    dist: 0,
    type: 'weld',
    runRole: 'MASTER',
    status: 'UNRESOLVED',
    rawData: {},
    lat: Number.NaN,
    lng: Number.NaN,
    ...overrides,
  };
}

test('an unmatched NEW GW becomes a side-qualified boundary with projected OLD distance', () => {
  const boundary = sectionBoundaryForFeature(feature({ id: 'NEW-X', dist: 18 }), locks);

  assert.deepEqual(boundary, {
    key: 'UNMATCHED::NEW::NEW-X::18.000000',
    side: 'NEW',
    label: 'NEW-X',
    oldId: null,
    newId: 'NEW-X',
    oldDistance: 15,
    newDistance: 18,
    sourceDistance: 18,
  });
});

test('an unmatched OLD GW becomes selectable without inventing a NEW identity', () => {
  const boundary = sectionBoundaryForFeature(feature({
    id: 'OLD-X',
    dist: 15,
    runRole: 'HISTORICAL',
    status: 'MISSING_IN_MASTER',
  }), locks);

  assert.equal(boundary?.side, 'OLD');
  assert.equal(boundary?.oldId, 'OLD-X');
  assert.equal(boundary?.newId, null);
  assert.equal(boundary?.newDistance, 18);
});

test('boundary collection keeps matched NEW markers and optional unmatched markers without duplicates', () => {
  const matched = feature({
    id: 'NEW-A',
    dist: 12,
    status: 'MATCHED',
    rawData: { lockedKey: 'A' },
  });
  const unmatchedNew = feature({ id: 'NEW-X', dist: 18 });
  const unmatchedOld = feature({
    id: 'OLD-X',
    dist: 15,
    runRole: 'HISTORICAL',
    status: 'MISSING_IN_MASTER',
  });
  const features: SpatialFeatures = {
    gws: [matched, unmatchedNew],
    allFeatures: [matched, unmatchedNew],
    historicalLanes: [{ id: 'old', label: 'OLD', gws: [
      feature({ id: 'OLD-A', dist: 10, runRole: 'HISTORICAL', status: 'MATCHED', rawData: { lockedKey: 'A' } }),
      unmatchedOld,
    ], bends: [] }],
    stats: { totalLength: 24, gwCount: 2, bendCount: 0, missingGwCount: 1 },
  };

  assert.deepEqual(
    buildSectionBoundaries(features, locks, true).map((boundary) => [boundary.label, boundary.side]),
    [['NEW-A', 'MATCHED'], ['NEW-X', 'NEW'], ['OLD-X', 'OLD']],
  );
  assert.deepEqual(
    buildSectionBoundaries(features, locks, false).map((boundary) => boundary.label),
    ['NEW-A'],
  );
});
