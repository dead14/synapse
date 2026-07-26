import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SCHEMATIC_ZOOM,
  canInspectGwPrecisely,
  clampSchematicZoom,
  shouldShowUnmatchedMarkerLabel,
} from '../src/sectioning/viewOptions.ts';

test('sectioning view keeps zoom within a usable range and shows missing labels only at detail zoom', () => {
  assert.equal(MAX_SCHEMATIC_ZOOM, 20);
  assert.equal(clampSchematicZoom(1000), 20);
  assert.equal(clampSchematicZoom(0), 0.5);
  assert.equal(shouldShowUnmatchedMarkerLabel(1), false);
  assert.equal(shouldShowUnmatchedMarkerLabel(2), true);
});

test('sectioning view only enables marker inspection at precision zoom', () => {
  assert.equal(canInspectGwPrecisely(1), false);
  assert.equal(canInspectGwPrecisely(6), true);
});
