export type RoutePoint = [number, number];

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function routeLengthMeters(route: RoutePoint[]) {
  let total = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    total += haversineMeters(route[index][0], route[index][1], route[index + 1][0], route[index + 1][1]);
  }
  return total;
}

/**
 * Position at `ratio` of the route measured by travelled distance, not by
 * vertex index.  Vertices are rarely evenly spaced, so index interpolation
 * puts features in the wrong place on any route drawn with uneven clicks.
 */
export function interpolateAlongRoute(route: RoutePoint[], ratio: number): { lat: number; lng: number } {
  if (route.length === 0) return { lat: Number.NaN, lng: Number.NaN };
  const first = { lat: route[0][0], lng: route[0][1] };
  if (route.length === 1) return first;

  const last = { lat: route[route.length - 1][0], lng: route[route.length - 1][1] };
  if (!Number.isFinite(ratio) || ratio <= 0) return first;
  if (ratio >= 1) return last;

  const totalLength = routeLengthMeters(route);
  if (totalLength === 0) return first;

  const target = ratio * totalLength;
  let travelled = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    const [startLat, startLng] = route[index];
    const [endLat, endLng] = route[index + 1];
    const segment = haversineMeters(startLat, startLng, endLat, endLng);
    if (travelled + segment >= target) {
      const local = segment === 0 ? 0 : (target - travelled) / segment;
      return {
        lat: startLat + (endLat - startLat) * local,
        lng: startLng + (endLng - startLng) * local,
      };
    }
    travelled += segment;
  }
  return last;
}

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

/**
 * Accepts decimal degrees, degrees-decimal-minutes and degrees-minutes-seconds,
 * with the hemisphere given either as a sign or as a N/S/E/W letter.
 *
 * The number of numeric groups decides the format, so `0 52.348 S` is read as
 * decimal minutes rather than being mistaken for seconds.  Returns null instead
 * of guessing when the text is not a coordinate.
 */
export function parseCoordinate(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hemisphere = trimmed.match(/^\s*([NSEWnsew])\b|([NSEWnsew])\s*$/);
  const direction = (hemisphere?.[1] ?? hemisphere?.[2] ?? '').toUpperCase();
  const body = trimmed.replace(/^\s*[NSEWnsew]\b/, '').replace(/[NSEWnsew]\s*$/, '');

  const groups = body.match(NUMBER_PATTERN);
  if (!groups || groups.length === 0 || groups.length > 3) return null;

  const [degrees, minutes = 0, seconds = 0] = groups.map((group) => Number.parseFloat(group.replace(',', '.')));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes >= 60 || seconds >= 60) return null;

  const magnitude = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  if (magnitude > 180) return null;

  // `degrees < 0` misses "-0 52 20", which is a real position just south of the
  // equator, so the sign is read from the text rather than from the number.
  const isNegative = /^\s*-/.test(body) || direction === 'S' || direction === 'W';
  return isNegative ? -magnitude : magnitude;
}

export function formatCoordinate(value: number | null) {
  return value === null || !Number.isFinite(value) ? '' : value.toFixed(6);
}
