import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuthoritativeLocation } from '../src/lib/digitalThread/location.ts';
import { reconcileFieldPackage } from '../src/lib/digitalThread/mobileSync.ts';

test('keeps engineering chainage authoritative while retaining GPS provenance', () => {
  const location = resolveAuthoritativeLocation({
    chainageM: 1200.5, stationing: 'KP 1+200.5', latitude: -6.2, longitude: 106.8,
    coordinateSource: 'field-gps', transformVersion: 'lrs-1',
  });
  assert.equal(location.authoritativeMeasure.type, 'chainage');
  assert.equal(location.spatialObservation.source, 'field-gps');
});

test('requires conflict resolution when offline and server revisions diverge', () => {
  const result = reconcileFieldPackage({
    packageId: 'job-1', baseRevision: 3, localRevision: 4, serverRevision: 5, pendingEvidence: 2,
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.canAutoMerge, false);
});
