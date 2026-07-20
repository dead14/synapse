import assert from 'node:assert/strict';
import test from 'node:test';
import { facilityRbiCapability } from '../src/lib/facilityRbi/capability.ts';

test('keeps qualitative facility RBI separate and quantitative API 581 unavailable', () => {
  const capability = facilityRbiCapability();
  assert.equal(capability.productBoundary, 'facility-rbi-add-on');
  assert.equal(capability.qualitativeScreening.available, true);
  assert.equal(capability.quantitativeApi581.available, false);
  assert.ok(capability.quantitativeApi581.missingValidation.length > 0);
});
