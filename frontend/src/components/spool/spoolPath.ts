/**
 * The centreline of the spool being viewed in 3D.
 *
 * A spool between two girth welds is only a straight cylinder when nothing
 * turns inside it. If the run reports a bend, an elbow or a jog between those
 * two welds, drawing the pipe straight tells the reviewer the metal runs
 * straight — and then puts every anomaly downstream of the bend at a clock
 * position that belongs to a pipe that does not exist. So the shell follows the
 * fittings that are actually in the window.
 *
 * One property makes this cheap and, more importantly, honest: an ILI odometer
 * measures along the pipe, so master-axis distance IS arc length on the
 * centreline. Curving the path therefore moves nothing axially — every feature
 * keeps the distance the run reported, and the axial ruler keeps its scale.
 *
 * Frame conventions, inherited from the straight view and preserved through
 * every bend:
 *
 * - `tangent` runs downstream.
 * - `up` is clock 12:00 and `right` is clock 3:00, so the outward normal at
 *   clock angle a is cos(a)·up + sin(a)·right.
 * - Bends rotate the whole frame about an axis perpendicular to the tangent,
 *   which introduces no twist: clock 12:00 stays clock 12:00 around the corner.
 */

import { maxBy, maxOf, minOf } from '../../utils/numericRange.ts';

export type Vec3 = [number, number, number];

export interface PathFrame {
  /** Arc length from the start of the window, in world units. */
  s: number;
  origin: Vec3;
  tangent: Vec3;
  up: Vec3;
  right: Vec3;
}

/** A turn in the centreline, in metres on the master axis. */
export interface PathBend {
  key: string;
  /** Where the turn is centred. */
  maM: number;
  angleDeg: number;
  /** Clock position, in degrees, the pipe deflects towards. */
  rollDeg: number;
  /** Bend radius in world units; the arc it needs follows from the angle. */
  radius: number;
}

export interface SpoolPath {
  /** Total centreline length in world units. */
  length: number;
  frames: PathFrame[];
  /** Point on the centreline at a master-axis distance. */
  frameAt(maM: number): PathFrame;
  /** Largest distance from the centred origin to any point on the path. */
  extent: number;
  /** Half-span down the original pipe axis, which sets the horizontal framing. */
  extentAxial: number;
  /** Half-span across it, which is what a bend adds to the vertical framing. */
  extentLateral: number;
  /** True when nothing in the window turns, so the pipe really is straight. */
  isStraight: boolean;
}

const SAMPLES = 480;

function add(a: Vec3, b: Vec3, scale = 1): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function normalise(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length === 0 ? [0, 0, 0] : scale(a, 1 / length);
}

/** Rodrigues rotation of `v` about the unit axis `axis` by `angle` radians. */
function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const crossed = cross(axis, v);
  return [
    v[0] * cos + crossed[0] * sin + axis[0] * dot * (1 - cos),
    v[1] * cos + crossed[1] * sin + axis[1] * dot * (1 - cos),
    v[2] * cos + crossed[2] * sin + axis[2] * dot * (1 - cos),
  ];
}

/**
 * Arc length a bend of this angle consumes at this radius. It is the length the
 * turn actually occupies on the odometer, which is why the path spends exactly
 * that much of the window curving.
 */
export function bendArcLength(angleDeg: number, radius: number): number {
  return Math.abs((angleDeg * Math.PI) / 180) * radius;
}

/**
 * Build the centreline for one window.
 *
 * `bends` are given on the master axis; `worldPerM` converts to world units so
 * the path shares the scale the rest of the pane already uses. The result is
 * centred on its own bounding box so the camera, which targets the origin,
 * frames a bent spool the same way it frames a straight one.
 */
export function buildSpoolPath(
  startM: number,
  endM: number,
  worldPerM: number,
  bends: PathBend[],
): SpoolPath {
  const spanM = Math.max(1e-6, endM - startM);
  const length = spanM * worldPerM;
  const step = length / SAMPLES;

  // Curvature is piecewise constant: 1/radius inside a bend's arc, zero
  // outside. Overlapping arcs would compound into a turn nobody reported, so
  // each arc is clamped to sit inside the window and away from its neighbours.
  const turns = bends
    .filter((bend) => Number.isFinite(bend.angleDeg) && bend.angleDeg !== 0 && bend.radius > 0)
    .map((bend) => {
      const centre = (bend.maM - startM) * worldPerM;
      const arc = Math.min(bendArcLength(bend.angleDeg, bend.radius), length);
      return {
        bend,
        start: Math.max(0, Math.min(length - arc, centre - arc / 2)),
        arc,
      };
    })
    .sort((left, right) => left.start - right.start);

  let cursor = 0;
  const arcs = turns.map((turn) => {
    const start = Math.max(turn.start, cursor);
    const arc = Math.min(turn.arc, Math.max(0, length - start));
    cursor = start + arc;
    return { ...turn, start, arc, end: start + arc };
  }).filter((turn) => turn.arc > 0);

  let origin: Vec3 = [0, 0, 0];
  let tangent: Vec3 = [1, 0, 0];
  let up: Vec3 = [0, 1, 0];
  let right: Vec3 = [0, 0, 1];
  const frames: PathFrame[] = [{ s: 0, origin, tangent, up, right }];

  for (let index = 1; index <= SAMPLES; index += 1) {
    const s = index * step;
    const midpoint = s - step / 2;
    const turn = arcs.find((candidate) => midpoint >= candidate.start && midpoint < candidate.end);
    if (turn) {
      const roll = (turn.bend.rollDeg * Math.PI) / 180;
      // The pipe deflects towards this clock direction; the rotation axis is
      // what takes the tangent there.
      const target = add(scale(up, Math.cos(roll)), scale(right, Math.sin(roll)));
      const axis = normalise(cross(tangent, target));
      const delta = (step / turn.bend.radius) * Math.sign(turn.bend.angleDeg);
      if (axis[0] !== 0 || axis[1] !== 0 || axis[2] !== 0) {
        tangent = normalise(rotate(tangent, axis, delta));
        up = normalise(rotate(up, axis, delta));
        right = normalise(rotate(right, axis, delta));
      }
    }
    origin = add(origin, tangent, step);
    frames.push({ s, origin, tangent, up, right });
  }

  // Centre on the bounding box so the pipe sits around the camera target.
  const xs = frames.map((frame) => frame.origin[0]);
  const ys = frames.map((frame) => frame.origin[1]);
  const zs = frames.map((frame) => frame.origin[2]);
  const centre: Vec3 = [
    (minOf(xs) + maxOf(xs)) / 2,
    (minOf(ys) + maxOf(ys)) / 2,
    (minOf(zs) + maxOf(zs)) / 2,
  ];
  const centred = frames.map((frame) => ({
    ...frame,
    origin: [
      frame.origin[0] - centre[0],
      frame.origin[1] - centre[1],
      frame.origin[2] - centre[2],
    ] as Vec3,
  }));
  const extent = maxBy(
    centred,
    (frame) => Math.hypot(frame.origin[0], frame.origin[1], frame.origin[2]),
    1e-6,
  );
  const extentAxial = maxBy(centred, (frame) => Math.abs(frame.origin[0]), 1e-6);
  const extentLateral = maxBy(
    centred,
    (frame) => Math.hypot(frame.origin[1], frame.origin[2]),
    0,
  );

  const frameAt = (maM: number): PathFrame => {
    const s = (maM - startM) * worldPerM;
    const position = Math.max(0, Math.min(SAMPLES, s / step));
    const lower = centred[Math.floor(position)];
    const upper = centred[Math.min(SAMPLES, Math.ceil(position))];
    if (lower === upper) return lower;
    const t = position - Math.floor(position);
    return {
      s,
      origin: [
        lower.origin[0] + (upper.origin[0] - lower.origin[0]) * t,
        lower.origin[1] + (upper.origin[1] - lower.origin[1]) * t,
        lower.origin[2] + (upper.origin[2] - lower.origin[2]) * t,
      ],
      // Direction vectors are taken from the nearer sample rather than blended:
      // a blend of two unit vectors is not a unit vector, and the patch basis
      // built from it would be skewed.
      tangent: t < 0.5 ? lower.tangent : upper.tangent,
      up: t < 0.5 ? lower.up : upper.up,
      right: t < 0.5 ? lower.right : upper.right,
    };
  };

  return {
    length,
    frames: centred,
    frameAt,
    extent,
    extentAxial,
    extentLateral,
    isStraight: arcs.length === 0,
  };
}
