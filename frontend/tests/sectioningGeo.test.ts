import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCoordinate,
  haversineMeters,
  interpolateAlongRoute,
  parseCoordinate,
  routeLengthMeters,
} from '../src/sectioning/geo.ts';

const closeTo = (actual: number, expected: number, tolerance: number) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test('parseCoordinate reads degrees-minutes-seconds with a hemisphere letter', () => {
  closeTo(parseCoordinate('0° 52\' 20.9270" S')!, -0.8724797, 1e-6);
  closeTo(parseCoordinate('117 15 59.6039 E')!, 117.2665566, 1e-6);
});

test('parseCoordinate reads degrees with decimal minutes instead of treating them as seconds', () => {
  // The old three-group regex read this as 0°52'348", which is a different place.
  closeTo(parseCoordinate("0° 52.348' S")!, -0.8724667, 1e-6);
  closeTo(parseCoordinate('1 30.0 N')!, 1.5, 1e-9);
});

test('parseCoordinate keeps the sign for positions just south or west of zero', () => {
  closeTo(parseCoordinate('-0° 52\' 20"')!, -0.8722222, 1e-6);
  closeTo(parseCoordinate('-6.234')!, -6.234, 1e-9);
  closeTo(parseCoordinate('6.234 W')!, -6.234, 1e-9);
});

test('parseCoordinate accepts plain and comma decimals', () => {
  closeTo(parseCoordinate('117.266556')!, 117.266556, 1e-9);
  closeTo(parseCoordinate('117,266556')!, 117.266556, 1e-9);
});

test('parseCoordinate returns null rather than guessing at unusable input', () => {
  assert.equal(parseCoordinate(''), null);
  assert.equal(parseCoordinate('   '), null);
  assert.equal(parseCoordinate('lokasi riser'), null);
  assert.equal(parseCoordinate('200'), null, 'out of coordinate range');
  assert.equal(parseCoordinate('10 75 0'), null, 'minutes must be below 60');
  assert.equal(parseCoordinate('10 30 0 15'), null, 'more groups than a DMS triple');
});

test('formatCoordinate renders six decimals and blanks out unusable values', () => {
  assert.equal(formatCoordinate(-0.8724797), '-0.872480');
  assert.equal(formatCoordinate(null), '');
  assert.equal(formatCoordinate(Number.NaN), '');
});

test('route length accumulates great-circle segments', () => {
  const oneThousandthDegree = haversineMeters(0, 0, 0, 0.001);
  closeTo(oneThousandthDegree, 111.19, 0.05);
  closeTo(routeLengthMeters([[0, 0], [0, 0.001], [0, 0.002]]), oneThousandthDegree * 2, 0.01);
});

test('route interpolation follows travelled distance, not vertex index', () => {
  // Second segment is nine times longer than the first, so the halfway point
  // must land inside it.  Index interpolation would return the middle vertex.
  const route: [number, number][] = [[0, 0], [0, 0.001], [0, 0.01]];
  const midpoint = interpolateAlongRoute(route, 0.5);
  closeTo(midpoint.lng, 0.005, 1e-4);
  assert.ok(midpoint.lng > 0.004, 'must not collapse onto the dense first segment');
});

test('route interpolation clamps to the endpoints and survives degenerate routes', () => {
  const route: [number, number][] = [[1, 1], [2, 2]];
  assert.deepEqual(interpolateAlongRoute(route, -5), { lat: 1, lng: 1 });
  assert.deepEqual(interpolateAlongRoute(route, 5), { lat: 2, lng: 2 });
  assert.deepEqual(interpolateAlongRoute([[3, 4]], 0.5), { lat: 3, lng: 4 });
  assert.deepEqual(interpolateAlongRoute([[3, 4], [3, 4]], 0.5), { lat: 3, lng: 4 });
  const empty = interpolateAlongRoute([], 0.5);
  assert.ok(Number.isNaN(empty.lat) && Number.isNaN(empty.lng));
});
