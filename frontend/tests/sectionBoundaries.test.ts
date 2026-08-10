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

test('a GW past the last lock extrapolates from the last segment, like the contract does', () => {
  // Three locks, because with two every segment is the last one and the wizard
  // agreed with the contract by accident. The pipe stretches on both sides of
  // the final lock, so the segment picked here decides the projection.
  const chain: LockedGwPair[] = [
    { key: 'A', oldId: 'OLD-A', newId: 'NEW-A', oldDistance: 0, newDistance: 0 },
    { key: 'B', oldId: 'OLD-B', newId: 'NEW-B', oldDistance: 10, newDistance: 12 },
    { key: 'C', oldId: 'OLD-C', newId: 'NEW-C', oldDistance: 20, newDistance: 23 },
  ];

  const boundary = sectionBoundaryForFeature(feature({ id: 'NEW-Y', dist: 30 }), chain);

  assert.equal(boundary?.oldDistance, 10 + ((30 - 12) / (23 - 12)) * (20 - 10));
  // What extrapolating from the first segment used to produce, and what
  // validateMatchingSections then rejected as invalid boundary evidence.
  assert.notEqual(boundary?.oldDistance, 25);
});

test('a GW whose projection runs off the other run is not offered as a boundary', () => {
  const offset: LockedGwPair[] = [
    { key: 'A', oldId: 'OLD-A', newId: 'NEW-A', oldDistance: 0, newDistance: 50 },
    { key: 'B', oldId: 'OLD-B', newId: 'NEW-B', oldDistance: 10, newDistance: 60 },
  ];

  assert.equal(sectionBoundaryForFeature(feature({ id: 'NEW-Z', dist: 0 }), offset), null);
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
