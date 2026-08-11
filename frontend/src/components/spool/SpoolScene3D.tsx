/**
 * The 3D pipe pane of the Spool Detail View.
 *
 * Geometry conventions, fixed here and relied on by every other pane:
 *
 * - The pipe follows a centreline built by {@link buildSpoolPath}. Master-axis
 *   distance is arc length along it, because that is what an ILI odometer
 *   measures, so a bend curves the shell without moving anything axially: the
 *   ruler under the pipe and the unrolled view below keep the same scale.
 * - Clock 12:00 is the frame's `up` and the angle increases towards `right`,
 *   which puts 3:00 on the right when the camera sits downstream. The frame is
 *   carried around bends without twist, so 12:00 stays 12:00 past the corner.
 * - Axial distance is true metres: one world unit is one metre, so a 12 m spool
 *   is 12 units long and picking a second spool draws a pipe exactly twice as
 *   long. Girth carries a constant exaggeration (GIRTH_EXAGGERATION) so
 *   that a single spool reads as a pipe rather than a hair. Earlier revisions
 *   stretched every window onto a fixed 10–40 unit stage, which squeezed one
 *   spool and twenty into the same shape and left screen lengths meaningless.
 * - Anomalies are drawn as excavations cut into the shell, sized from the
 *   reported length (axial), width (circumferential) and depth (wall loss =
 *   depth%WT × wall thickness). They curve with the pipe: the width is an arc on
 *   the shell, not a chord across it, so a patch stays on the metal however wide
 *   it is. Clock extent is preserved as a true angle, so this pane and the
 *   unrolled one agree on where a defect sits around the pipe. The width is a
 *   true arc only when an outside diameter is supplied; without one the patch
 *   keeps a nominal arc and the view says so rather than implying a measurement.
 *
 * Marker scale is a display multiplier, never a data change. Real ILI defects
 * on a 12 m spool are a few centimetres across and vanish at true scale, so the
 * pane exaggerates by default and states the factor on screen. It is bounded —
 * see `drawnArcDeg` and `drawnAxialM` — because a magnification that can take a
 * patch off the pipe is not a magnification of the pipe. The numbers in the
 * hover card are always the measured ones.
 */

import { useEffect, useMemo } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Line, Text, Html } from '@react-three/drei';
import * as THREE from 'three';

import {
  arcWidthDeg,
  type SpoolFeature,
} from '../../domain/spoolFeatures.ts';
import { depthRgb, STATUS_COLOR, type DepthPalette } from './spoolPalette.ts';
import {
  axialTicks,
  bendRadiusM,
  drawnArcDeg,
  drawnAxialM,
  drawnRadialM,
  sceneScale,
  type SceneScale,
} from './spoolScale.ts';
import { bendArcLength, buildSpoolPath, type PathFrame, type SpoolPath, type Vec3 } from './spoolPath.ts';
import type { SpoolFitting } from './spoolFittings.ts';

export type CameraPreset = 'home' | 'top' | 'bottom' | 'left' | 'right' | 'look-along';

export interface SceneViewOptions {
  xray: boolean;
  cutaway: boolean;
  crossSection: boolean;
  markerScale: number;
  showPrevious: boolean;
  /** Draw valve bodies, tee branches and flanges reported in this window. */
  showFittings: boolean;
}

export interface CameraCommand {
  preset: CameraPreset;
  /** Bumped on every request so repeating the same preset still fires. */
  nonce: number;
  /** Negative dollies out, positive dollies in, 0 leaves the distance alone. */
  zoom?: number;
}

interface SpoolScene3DProps {
  features: SpoolFeature[];
  welds: Array<{ id: string; maM: number }>;
  fittings: SpoolFitting[];
  startM: number;
  endM: number;
  odMm: number | null;
  palette: DepthPalette;
  selectedKey: string | null;
  onSelect: (feature: SpoolFeature | null, event?: { clientX: number; clientY: number }) => void;
  onHover: (feature: SpoolFeature | null) => void;
  hovered: SpoolFeature | null;
  view: SceneViewOptions;
  command: CameraCommand;
  measureMode: boolean;
  measurePicks: SpoolFeature[];
}

const SHELL_SEGMENTS = 64;
/** Circumferential facets across one patch, per 10 degrees of its arc. */
const PATCH_STEPS_PER_10_DEG = 1;
const MIN_PATCH_STEPS = 2;
const MAX_PATCH_STEPS = 16;

function vec(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

/** Outward surface direction at a clock angle, in the frame's own basis. */
function surfaceNormal(frame: PathFrame, angleRad: number): THREE.Vector3 {
  return vec(frame.up).multiplyScalar(Math.cos(angleRad))
    .addScaledVector(vec(frame.right), Math.sin(angleRad));
}

/** Cross-section basis: local XY is the pipe's cross-section plane. */
function ringMatrix(frame: PathFrame, offset = 0): THREE.Matrix4 {
  const matrix = new THREE.Matrix4().makeBasis(vec(frame.up), vec(frame.right), vec(frame.tangent));
  matrix.setPosition(vec(frame.origin).addScaledVector(vec(frame.tangent), offset));
  return matrix;
}

/**
 * One metal-loss excavation on the shell.
 *
 * It is held as the pipe's own coordinates — a frame, a clock angle, an arc, an
 * axial length and a wall depth — rather than as a transform of a unit cube,
 * because a cube cannot bend. A patch covering any real fraction of the
 * circumference has to curve with the shell; drawn as a flat plate it lifts off
 * the pipe at its edges and, once the marker magnification pushes the arc past
 * a right angle, leaves the pipe altogether as a slab hanging in space.
 */
interface PlacedPatch {
  feature: SpoolFeature;
  frame: PathFrame;
  /** Centre of the patch around the circumference, radians from 12 o'clock. */
  angleRad: number;
  arcRad: number;
  axialM: number;
  /** Shell surface the patch is cut into, and the floor left under it. */
  outerRadius: number;
  innerRadius: number;
  color: THREE.Color;
  corners: Array<[number, number, number]>;
  anchor: [number, number, number];
}

/** A point on the patch: `u` runs -0.5…0.5 axially, `v` the same around. */
function patchPoint(patch: PlacedPatch, u: number, v: number, radius: number): THREE.Vector3 {
  const angle = patch.angleRad + v * patch.arcRad;
  return vec(patch.frame.origin)
    .addScaledVector(vec(patch.frame.tangent), u * patch.axialM)
    .addScaledVector(surfaceNormal(patch.frame, angle), radius);
}

function patchSteps(patch: PlacedPatch): number {
  const degrees = (patch.arcRad * 180) / Math.PI;
  return Math.min(
    MAX_PATCH_STEPS,
    Math.max(MIN_PATCH_STEPS, Math.round((degrees / 10) * PATCH_STEPS_PER_10_DEG) + 1),
  );
}

function placeFeatures(
  features: SpoolFeature[],
  side: 'current' | 'previous',
  path: SpoolPath,
  scale: SceneScale,
  odMm: number | null,
  palette: DepthPalette,
  markerScale: number,
): PlacedPatch[] {
  // The world is metric, so a reported millimetre is a reported millimetre: the
  // only conversion is mm → m. Nothing is stretched to fit the picture.
  const surfaceRadius = scale.radius * (side === 'current' ? 1.002 : 1.0005);
  // A defect smaller than this is drawn at this size instead of disappearing
  // into a sub-pixel sliver. It is a floor on the drawing, not on the data.
  const minPatch = scale.spanM * 0.0015;
  const minArcRad = minPatch / surfaceRadius;
  const placed: PlacedPatch[] = [];

  features.forEach((feature) => {
    const data = feature[side];
    if (!data.present) return;
    const maM = data.maM ?? feature.maM;
    const clockDeg = data.clockDeg ?? feature.clockDeg;
    const angle = (clockDeg * Math.PI) / 180;
    const frame = path.frameAt(maM);

    const axialM = Math.max(minPatch, drawnAxialM(data.lengthMm, markerScale, scale.spanM));
    // The arc is a true angle on the shell, so this pane and the unrolled one
    // agree on where a defect sits around the pipe. Both ask the same helper
    // how large to draw it, so neither can drift from the other.
    const arcDeg = drawnArcDeg(arcWidthDeg(data.widthMm, odMm), markerScale);
    const arcRad = Math.max(minArcRad, (arcDeg * Math.PI) / 180);
    // Depth is the wall the run says is gone. It is radial, so it carries the
    // same girth exaggeration the shell does — otherwise a pit would read four
    // times shallower against the drawn wall than it is against the real one.
    // Without a wall thickness there is no depth to draw, so the excavation
    // degenerates to a skin-thin patch.
    const wallLossMm = data.depthPct === null || data.wtMm === null
      ? 0
      : (data.depthPct / 100) * data.wtMm;
    const radialM = drawnRadialM(wallLossMm, markerScale, scale.radius, scale.girth);

    const [r, g, b] = side === 'current'
      ? depthRgb(data.depthPct, palette)
      : [120, 130, 148];
    const anchorPoint = vec(frame.origin)
      .addScaledVector(surfaceNormal(frame, angle), scale.radius * 1.06);

    const patch: PlacedPatch = {
      feature,
      frame,
      angleRad: angle,
      arcRad,
      axialM,
      outerRadius: surfaceRadius,
      innerRadius: Math.max(surfaceRadius * 0.05, surfaceRadius - radialM),
      color: new THREE.Color(r / 255, g / 255, b / 255),
      corners: [],
      anchor: [anchorPoint.x, anchorPoint.y, anchorPoint.z],
    };
    // The outline traces the mouth of the excavation, so it follows the same
    // curve the mouth does rather than cutting the corner across it.
    patch.corners = patchOutline(patch);
    placed.push(patch);
  });

  return placed;
}

/** Perimeter of a patch's outer face, sampled around its arc. */
function patchOutline(patch: PlacedPatch): Array<[number, number, number]> {
  const steps = patchSteps(patch);
  const lift = patch.outerRadius * 1.004;
  const points: Array<[number, number, number]> = [];
  const push = (u: number, v: number) => {
    const point = patchPoint(patch, u, v, lift);
    points.push([point.x, point.y, point.z]);
  };
  for (let step = 0; step <= steps; step += 1) push(-0.5, -0.5 + step / steps);
  for (let step = 0; step <= steps; step += 1) push(0.5, 0.5 - step / steps);
  push(-0.5, -0.5);
  return points;
}

/**
 * Every patch merged into one geometry, with the feature each triangle belongs
 * to recorded alongside it.
 *
 * One mesh per defect would be hundreds of draw calls on a busy spool, and an
 * instanced cube — which is what this was — cannot follow the shell. Merging
 * keeps the single draw call and buys the curve; the owner table is what keeps
 * a click on a triangle resolvable back to the anomaly it belongs to.
 */
function buildPatchGeometry(placed: PlacedPatch[]): {
  geometry: THREE.BufferGeometry;
  owners: Uint32Array;
} {
  const positions: number[] = [];
  const colors: number[] = [];
  const owners: number[] = [];

  const triangle = (
    index: number,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    color: THREE.Color,
  ) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let vertex = 0; vertex < 3; vertex += 1) colors.push(color.r, color.g, color.b);
    owners.push(index);
  };
  const quad = (
    index: number,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
  ) => {
    triangle(index, a, b, c, color);
    triangle(index, a, c, d, color);
  };

  placed.forEach((patch, index) => {
    const steps = patchSteps(patch);
    const outer: THREE.Vector3[][] = [];
    const inner: THREE.Vector3[][] = [];
    for (const u of [-0.5, 0.5]) {
      const outerRing: THREE.Vector3[] = [];
      const innerRing: THREE.Vector3[] = [];
      for (let step = 0; step <= steps; step += 1) {
        const v = -0.5 + step / steps;
        outerRing.push(patchPoint(patch, u, v, patch.outerRadius));
        innerRing.push(patchPoint(patch, u, v, patch.innerRadius));
      }
      outer.push(outerRing);
      inner.push(innerRing);
    }

    for (let step = 0; step < steps; step += 1) {
      // Mouth and floor.
      quad(index, outer[0][step], outer[1][step], outer[1][step + 1], outer[0][step + 1], patch.color);
      quad(index, inner[0][step + 1], inner[1][step + 1], inner[1][step], inner[0][step], patch.color);
      // The two walls square across the pipe, at each end of the length.
      quad(index, outer[0][step + 1], inner[0][step + 1], inner[0][step], outer[0][step], patch.color);
      quad(index, outer[1][step], inner[1][step], inner[1][step + 1], outer[1][step + 1], patch.color);
    }
    // The two walls running along the pipe, at each edge of the width.
    quad(index, outer[0][0], inner[0][0], inner[1][0], outer[1][0], patch.color);
    quad(index, outer[1][steps], inner[1][steps], inner[0][steps], outer[0][steps], patch.color);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, owners: Uint32Array.from(owners) };
}

// ─── Shell ──────────────────────────────────────────────────────────────────

/**
 * The shell, swept along the centreline. It is built here rather than with
 * TubeGeometry because the cutaway has to open the pipe along a theta range,
 * and because the sweep must use the same frames the patches are placed with —
 * a shell and a defect drawn from two different frames is exactly the drift
 * this workspace exists to prevent.
 */
function useShellGeometry(path: SpoolPath, radius: number, cutaway: boolean): THREE.BufferGeometry {
  return useMemo(() => {
    const thetaStart = cutaway ? Math.PI / 2 : 0;
    const thetaLength = cutaway ? Math.PI : Math.PI * 2;
    const rings = path.frames;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    rings.forEach((frame, ringIndex) => {
      for (let step = 0; step <= SHELL_SEGMENTS; step += 1) {
        const angle = thetaStart + (step / SHELL_SEGMENTS) * thetaLength;
        const normal = surfaceNormal(frame, angle);
        const point = vec(frame.origin).addScaledVector(normal, radius);
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(ringIndex / Math.max(1, rings.length - 1), step / SHELL_SEGMENTS);
      }
    });

    const stride = SHELL_SEGMENTS + 1;
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let step = 0; step < SHELL_SEGMENTS; step += 1) {
        const a = ring * stride + step;
        const b = a + stride;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }, [path, radius, cutaway]);
}

function PipeShell({
  path,
  radius,
  welds,
  view,
  clippingPlanes,
}: {
  path: SpoolPath;
  radius: number;
  welds: Array<{ id: string; maM: number }>;
  view: SceneViewOptions;
  clippingPlanes: THREE.Plane[];
}) {
  const geometry = useShellGeometry(path, radius, view.cutaway);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#2f7fbf"
          metalness={0.25}
          roughness={0.62}
          side={THREE.DoubleSide}
          transparent={view.xray}
          opacity={view.xray ? 0.28 : 1}
          depthWrite={!view.xray}
          clippingPlanes={clippingPlanes}
          clipShadows
        />
      </mesh>

      {/* Girth welds: a raised bead the eye can count spools by. */}
      {welds.map((weld) => (
        <mesh key={weld.id} matrixAutoUpdate={false} matrix={ringMatrix(path.frameAt(weld.maM))}>
          <torusGeometry args={[radius * 1.008, radius * 0.028, 12, 72]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.35} clippingPlanes={clippingPlanes} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Pipe furniture ─────────────────────────────────────────────────────────

/**
 * Valve bodies, tee branches and flanges, drawn where the run reported them.
 *
 * They are translucent on purpose: the reason for putting them on the pipe is
 * to read the metal loss around them, and an opaque valve body would hide the
 * very defects the reviewer opened this pane to see.
 */
function FittingBodies({
  path,
  radius,
  trueRadius,
  fittings,
  clippingPlanes,
}: {
  path: SpoolPath;
  radius: number;
  /** Real outside radius, for anything measured along the master axis. */
  trueRadius: number;
  fittings: SpoolFitting[];
  clippingPlanes: THREE.Plane[];
}) {
  return (
    <group>
      {fittings.map((fitting) => {
        const frame = path.frameAt(fitting.maM);
        const roll = (fitting.rollDeg * Math.PI) / 180;

        if (fitting.kind === 'valve') {
          const stem = surfaceNormal(frame, roll);
          const body = new THREE.Matrix4().makeBasis(
            vec(frame.up), vec(frame.right), vec(frame.tangent),
          ).setPosition(vec(frame.origin));
          const wheel = new THREE.Matrix4().makeBasis(
            vec(frame.tangent), new THREE.Vector3().crossVectors(stem, vec(frame.tangent)), stem,
          ).setPosition(vec(frame.origin).addScaledVector(stem, radius * 2.3));
          return (
            <group key={fitting.key}>
              <mesh matrixAutoUpdate={false} matrix={body}>
                <cylinderGeometry args={[radius * 1.35, radius * 1.35, radius * 1.1, 24, 1, false]} />
                <meshStandardMaterial color="#a855f7" metalness={0.5} roughness={0.4} transparent opacity={0.42} clippingPlanes={clippingPlanes} />
              </mesh>
              <mesh
                matrixAutoUpdate={false}
                matrix={new THREE.Matrix4().makeBasis(
                  vec(frame.tangent), stem, new THREE.Vector3().crossVectors(vec(frame.tangent), stem),
                ).setPosition(vec(frame.origin).addScaledVector(stem, radius * 1.6))}
              >
                <cylinderGeometry args={[radius * 0.09, radius * 0.09, radius * 1.6, 12]} />
                <meshStandardMaterial color="#c4b5fd" metalness={0.6} roughness={0.35} clippingPlanes={clippingPlanes} />
              </mesh>
              <mesh matrixAutoUpdate={false} matrix={wheel}>
                <torusGeometry args={[radius * 0.45, radius * 0.06, 10, 32]} />
                <meshStandardMaterial color="#c4b5fd" metalness={0.6} roughness={0.35} clippingPlanes={clippingPlanes} />
              </mesh>
            </group>
          );
        }

        if (fitting.kind === 'tee') {
          const branch = surfaceNormal(frame, roll);
          const sideways = new THREE.Vector3().crossVectors(branch, vec(frame.tangent));
          const basis = new THREE.Matrix4().makeBasis(vec(frame.tangent), branch, sideways);
          return (
            <group key={fitting.key}>
              <mesh
                matrixAutoUpdate={false}
                matrix={basis.clone().setPosition(vec(frame.origin).addScaledVector(branch, radius * 0.9))}
              >
                <cylinderGeometry args={[radius * 0.55, radius * 0.55, radius * 1.8, 20, 1, true]} />
                <meshStandardMaterial color="#38bdf8" metalness={0.35} roughness={0.5} side={THREE.DoubleSide} transparent opacity={0.5} clippingPlanes={clippingPlanes} />
              </mesh>
              <mesh
                matrixAutoUpdate={false}
                matrix={basis.clone().setPosition(vec(frame.origin).addScaledVector(branch, radius * 1.8))}
              >
                <cylinderGeometry args={[radius * 0.75, radius * 0.75, radius * 0.12, 20]} />
                <meshStandardMaterial color="#7dd3fc" metalness={0.5} roughness={0.4} clippingPlanes={clippingPlanes} />
              </mesh>
            </group>
          );
        }

        if (fitting.kind === 'flange') {
          return (
            <mesh key={fitting.key} matrixAutoUpdate={false} matrix={ringMatrix(frame)}>
              <torusGeometry args={[radius * 1.12, radius * 0.12, 12, 40]} />
              <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.35} clippingPlanes={clippingPlanes} />
            </mesh>
          );
        }

        if (fitting.kind !== 'bend' || fitting.angleDeg === null) return null;
        // A bend is the shell itself; what is drawn here is where it starts and
        // ends, so the reviewer can see which metal is in the curve. The arc is
        // odometer distance, so it comes off the real radius, not the drawn one.
        const halfArcM = bendArcLength(fitting.angleDeg, bendRadiusM(trueRadius)) / 2;
        return (
          <group key={fitting.key}>
            {[-halfArcM, halfArcM].map((offset, index) => (
              <mesh
                key={index}
                matrixAutoUpdate={false}
                matrix={ringMatrix(path.frameAt(fitting.maM + offset))}
              >
                <torusGeometry args={[radius * 1.02, radius * 0.035, 10, 48]} />
                <meshStandardMaterial color="#fb923c" metalness={0.6} roughness={0.4} clippingPlanes={clippingPlanes} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

// ─── Anomaly patches ────────────────────────────────────────────────────────

function PatchLayer({
  placed,
  opacity,
  onPick,
  onHover,
  interactive,
}: {
  placed: PlacedPatch[];
  opacity: number;
  onPick?: (feature: SpoolFeature, event: ThreeEvent<MouseEvent>) => void;
  onHover?: (feature: SpoolFeature | null) => void;
  interactive: boolean;
}) {
  // A solid excavation, not a decal: metal loss has a depth, and a skin on the
  // shell cannot show the difference between a 10 %WT patch and a 60 %WT pit.
  const built = useMemo(() => buildPatchGeometry(placed), [placed]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.5,
    metalness: 0.1,
    transparent: opacity < 1,
    opacity,
  }), [opacity]);

  useEffect(() => () => built.geometry.dispose(), [built]);
  useEffect(() => () => material.dispose(), [material]);

  const patchAt = (event: ThreeEvent<MouseEvent>): PlacedPatch | null => {
    const owner = built.owners[event.faceIndex ?? -1];
    return owner === undefined ? null : placed[owner] ?? null;
  };

  if (placed.length === 0) return null;

  return (
    <mesh
      geometry={built.geometry}
      material={material}
      onPointerOver={interactive ? (event) => {
        event.stopPropagation();
        document.body.style.cursor = 'pointer';
        onHover?.(patchAt(event)?.feature ?? null);
      } : undefined}
      onPointerMove={interactive ? (event) => {
        event.stopPropagation();
        onHover?.(patchAt(event)?.feature ?? null);
      } : undefined}
      onPointerOut={interactive ? (event) => {
        event.stopPropagation();
        document.body.style.cursor = 'default';
        onHover?.(null);
      } : undefined}
      onClick={interactive ? (event) => {
        event.stopPropagation();
        const patch = patchAt(event);
        if (patch && onPick) onPick(patch.feature, event);
      } : undefined}
    />
  );
}

// ─── Decorations ────────────────────────────────────────────────────────────

/**
 * The ruler follows the pipe, so it still reads under a bent spool.
 *
 * At true scale a transmission pipe is a long thin cylinder, so the labels are
 * necessarily large next to its girth. They are pushed clear of the shell by
 * their own height rather than by a fraction of the radius, which keeps them
 * off the metal at every diameter.
 */
function AxialRuler({
  path, scale, startM, endM,
}: { path: SpoolPath; scale: SceneScale; startM: number; endM: number }) {
  const offset = -(scale.radius + scale.label * 1.9);
  const rail = useMemo(
    () => path.frames.map((frame) => {
      const point = vec(frame.origin).addScaledVector(vec(frame.up), offset);
      return [point.x, point.y, point.z] as [number, number, number];
    }),
    [path, offset],
  );
  const ticks = useMemo(
    () => axialTicks(startM, endM).map((m) => ({ m, frame: path.frameAt(m) })),
    [path, startM, endM],
  );
  const midpoint = path.frameAt((startM + endM) / 2);
  const label = vec(midpoint.origin).addScaledVector(vec(midpoint.up), offset - scale.label * 2.8);

  return (
    <group>
      <Line points={rail} color="#7c8899" lineWidth={1} />
      {ticks.map(({ m, frame }) => {
        const base = vec(frame.origin).addScaledVector(vec(frame.up), offset);
        const top = vec(frame.origin).addScaledVector(vec(frame.up), offset + scale.label * 0.6);
        const text = vec(frame.origin).addScaledVector(vec(frame.up), offset - scale.label * 1.2);
        return (
          <group key={m}>
            <Line points={[[base.x, base.y, base.z], [top.x, top.y, top.z]]} color="#94a3b8" lineWidth={1} />
            <Text position={[text.x, text.y, text.z]} fontSize={scale.label} color="#cbd5e1" anchorX="center" anchorY="middle">
              {`${Number.isInteger(m) ? m : m.toFixed(1)} m`}
            </Text>
          </group>
        );
      })}
      <Text position={[label.x, label.y, label.z]} fontSize={scale.label * 1.05} color="#94a3b8" anchorX="center" anchorY="middle">
        Master Axis (m)
      </Text>
    </group>
  );
}

function ClockRing({ frame, scale }: { frame: PathFrame; scale: SceneScale }) {
  const points = useMemo(() => {
    const ring: Array<[number, number, number]> = [];
    for (let step = 0; step <= 72; step += 1) {
      const angle = (step / 72) * Math.PI * 2;
      const point = vec(frame.origin)
        .addScaledVector(surfaceNormal(frame, angle), scale.radius * 1.12)
        .addScaledVector(vec(frame.tangent), scale.radius * 0.025);
      ring.push([point.x, point.y, point.z]);
    }
    return ring;
  }, [frame, scale.radius]);

  const labels: Array<[string, number]> = [['12:00', 0], ['3:00', 90], ['6:00', 180], ['9:00', 270]];

  return (
    <group>
      <Line
        points={points}
        color="#cbd5e1"
        lineWidth={1}
        dashed
        dashSize={scale.radius * 0.06}
        gapSize={scale.radius * 0.05}
      />
      {labels.map(([label, deg]) => {
        const angle = (deg * Math.PI) / 180;
        const point = vec(frame.origin)
          .addScaledVector(surfaceNormal(frame, angle), scale.radius * 1.2 + scale.label)
          .addScaledVector(vec(frame.tangent), scale.radius * 0.05);
        return (
          <Text
            key={label}
            position={[point.x, point.y, point.z]}
            fontSize={scale.label}
            color="#e2e8f0"
            anchorX="center"
            anchorY="middle"
          >
            {label}
          </Text>
        );
      })}
    </group>
  );
}

function CrossSectionRing({ frame, radius }: { frame: PathFrame; radius: number }) {
  const points = useMemo(() => {
    const ring: Array<[number, number, number]> = [];
    for (let step = 0; step <= 96; step += 1) {
      const angle = (step / 96) * Math.PI * 2;
      const point = vec(frame.origin).addScaledVector(surfaceNormal(frame, angle), radius);
      ring.push([point.x, point.y, point.z]);
    }
    return ring;
  }, [frame, radius]);
  return <Line points={points} color="#f8fafc" lineWidth={2} />;
}

// ─── Camera ─────────────────────────────────────────────────────────────────

function CameraRig({
  command, path, scale,
}: { command: CameraCommand; path: SpoolPath; scale: SceneScale }) {
  const radius = scale.radius;
  const camera = useThree((state) => state.camera);
  // `controls` is typed as a bare EventDispatcher until a controls implementation
  // registers itself; OrbitControls is the one mounted here, hence the narrowing.
  const controls = useThree((state) => state.controls) as unknown as
    { target: THREE.Vector3; update: () => void } | null;

  useEffect(() => {
    if (!controls) return;

    // Frame the spool from the viewport it actually has: a wide stage needs a
    // nearer camera than a narrow one for the same pipe, and guessing a fixed
    // distance is what leaves the pipe either a sliver or clipped at the ends.
    const perspective = camera as THREE.PerspectiveCamera;
    const vFov = ((perspective.fov ?? 42) * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (perspective.aspect || 1));
    // A straight spool is framed by its length; a bent one also has to fit the
    // span the turn puts across the axis, which a girth-only guess would clip.
    // The ruler and its labels hang below the shell, so the vertical fit has to
    // clear them too or the metre marks sit outside the frame.
    const forLength = (path.extentAxial + radius) / Math.tan(hFov / 2);
    const forGirth = (path.extentLateral + radius * 1.2 + scale.label * 4.5) / Math.tan(vFov / 2);
    const distance = Math.max(forLength, forGirth) * 1.06;
    // Down the axis only the diameter has to fit, so that view sits far closer.
    const axialDistance = Math.max(forGirth * 0.6, radius * 4);

    const directions: Record<CameraPreset, [number, number, number, number]> = {
      home: [0.44, 0.32, 0.84, distance],
      top: [0.001, 1, 0.002, distance],
      bottom: [0.001, -1, 0.002, distance],
      right: [0.002, 0.001, 1, distance],
      left: [0.002, 0.001, -1, distance],
      'look-along': [-1, 0.08, 0.002, axialDistance],
    };
    const positions = Object.fromEntries(
      Object.entries(directions).map(([preset, [x, y, z, dollyDistance]]) => {
        const direction = new THREE.Vector3(x, y, z).normalize().multiplyScalar(dollyDistance);
        return [preset, [direction.x, direction.y, direction.z] as [number, number, number]];
      }),
    ) as Record<CameraPreset, [number, number, number]>;

    if (command.zoom) {
      // Dolly along the view ray instead of touching fov, so the axial ruler
      // keeps its scale relationship with the unrolled pane.
      const target = controls.target;
      const offset = camera.position.clone().sub(target);
      const factor = command.zoom > 0 ? 0.8 : 1.25;
      const next = offset.multiplyScalar(factor);
      const clamped = Math.min(
        Math.max(next.length(), radius * 1.15),
        Math.max(path.extent * 8, radius * 40),
      );
      camera.position.copy(target.clone().add(next.setLength(clamped)));
    } else {
      const [x, y, z] = positions[command.preset];
      camera.position.set(x, y, z);
      controls.target.set(0, 0, 0);
    }
    camera.updateProjectionMatrix();
    controls.update();
  }, [camera, controls, command, path]);

  return null;
}

// ─── Pane ───────────────────────────────────────────────────────────────────

export default function SpoolScene3D({
  features,
  welds,
  fittings,
  startM,
  endM,
  odMm,
  palette,
  selectedKey,
  onSelect,
  onHover,
  hovered,
  view,
  command,
  measureMode,
  measurePicks,
}: SpoolScene3DProps) {
  const spanM = Math.max(0.01, endM - startM);
  const bends = useMemo(
    () => fittings.filter((fitting) => fitting.kind === 'bend' && fitting.angleDeg !== null),
    [fittings],
  );
  // Axial distance is true metres, so the centreline is built at true length: a
  // 12 m spool is 12 units of pipe, not a fixed stage the window is squeezed on.
  // A bend caps how far the girth can be exaggerated before the elbow folds.
  const scale = useMemo(
    () => sceneScale(spanM, odMm, { hasBend: bends.length > 0 }),
    [spanM, odMm, bends.length],
  );
  const radius = scale.radius;

  const path = useMemo(
    () => buildSpoolPath(startM, endM, 1, bends.map((fitting) => ({
      key: fitting.key,
      maM: fitting.maM,
      angleDeg: fitting.angleDeg as number,
      rollDeg: fitting.rollDeg,
      // The arc an elbow consumes is odometer distance, so it turns on the real
      // radius. Using the drawn one made a bend eat the girth exaggeration's
      // worth of extra master axis and displaced every feature after it.
      radius: bendRadiusM(scale.trueRadius),
    }))),
    [startM, endM, scale.trueRadius, bends],
  );

  const currentPatches = useMemo(
    () => placeFeatures(features, 'current', path, scale, odMm, palette, view.markerScale),
    [features, path, scale, odMm, palette, view.markerScale],
  );

  const previousPatches = useMemo(
    () => (view.showPrevious
      ? placeFeatures(
        features.filter((feature) => feature.previous.present),
        'previous', path, scale, odMm, palette, view.markerScale,
      )
      : []),
    [features, view.showPrevious, path, scale, odMm, palette, view.markerScale],
  );

  const selectedPatch = currentPatches.find((patch) => patch.feature.key === selectedKey)
    ?? previousPatches.find((patch) => patch.feature.key === selectedKey)
    ?? null;
  const hoveredPatch = hovered
    ? currentPatches.find((patch) => patch.feature.key === hovered.key) ?? null
    : null;
  const labelPatch = hoveredPatch ?? selectedPatch;
  const labelFeature = labelPatch?.feature ?? null;

  const crossSectionFrame = selectedPatch ? path.frameAt(selectedPatch.feature.maM) : null;
  const clippingPlanes = useMemo(() => {
    if (!view.crossSection || !crossSectionFrame) return [];
    // Cut across the pipe where it actually points, which downstream of a bend
    // is no longer the world X axis.
    const normal = vec(crossSectionFrame.tangent).negate();
    return [new THREE.Plane(normal, -normal.dot(vec(crossSectionFrame.origin)))];
  }, [view.crossSection, crossSectionFrame]);

  const measurePoints = measurePicks
    .map((pick) => currentPatches.find((patch) => patch.feature.key === pick.key)?.anchor)
    .filter((anchor): anchor is [number, number, number] => Boolean(anchor));

  return (
    // preserveDrawingBuffer keeps the frame readable after compositing, which is
    // what the snapshot button needs in order to hand back a PNG.
    <Canvas
      camera={{
        position: [spanM * 0.42, radius * 2.6 + scale.label * 2, spanM * 0.75],
        fov: 42,
        // The near plane has to sit inside the pipe wall, or zooming in to read a
        // pit clips the very metal the reviewer is trying to see.
        near: Math.max(0.002, radius * 0.02),
        far: Math.max(200, spanM * 40),
      }}
      gl={{ localClippingEnabled: true, antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => { if (!measureMode) onSelect(null); }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[8, 14, 10]} intensity={1.35} />
      <directionalLight position={[-10, -6, -8]} intensity={0.45} color="#93c5fd" />

      <PipeShell path={path} radius={radius} welds={welds} view={view} clippingPlanes={clippingPlanes} />
      {view.showFittings && (
        <FittingBodies
          path={path}
          radius={radius}
          trueRadius={scale.trueRadius}
          fittings={fittings}
          clippingPlanes={clippingPlanes}
        />
      )}

      <PatchLayer placed={previousPatches} opacity={0.42} interactive={false} />
      <PatchLayer
        placed={currentPatches}
        opacity={1}
        interactive
        onHover={onHover}
        onPick={(feature, event) => onSelect(feature, { clientX: event.clientX, clientY: event.clientY })}
      />

      {selectedPatch && (
        <Line
          points={selectedPatch.corners}
          color="#ffffff"
          lineWidth={2}
          dashed
          dashSize={radius * 0.05}
          gapSize={radius * 0.04}
        />
      )}
      {view.crossSection && crossSectionFrame && (
        <CrossSectionRing frame={crossSectionFrame} radius={radius} />
      )}
      {measurePoints.length === 2 && (
        <Line points={measurePoints} color="#fbbf24" lineWidth={2} />
      )}

      <AxialRuler path={path} scale={scale} startM={startM} endM={endM} />
      <ClockRing frame={path.frameAt(endM)} scale={scale} />

      {labelFeature && labelPatch && (
        <Html
          position={labelPatch.anchor}
          distanceFactor={Math.max(spanM, radius * 12) * 0.9}
          zIndexRange={[40, 0]}
        >
          <div className="spool-scene__card">
            <div className="spool-scene__card-head">
              <strong>{labelFeature.id}</strong>
              <span style={{ color: STATUS_COLOR[labelFeature.status] }}>
                {labelFeature.featureClass.replace('-', ' ')}
              </span>
            </div>
            <dl>
              <div><dt>MA</dt><dd>{labelFeature.maM.toFixed(2)} m</dd></div>
              <div><dt>Clock</dt><dd>{labelFeature.clockLabel}</dd></div>
              <div><dt>Length</dt><dd>{labelFeature.current.lengthMm ?? '—'} mm</dd></div>
              <div><dt>Width</dt><dd>{labelFeature.current.widthMm ?? '—'} mm</dd></div>
              <div><dt>Max depth</dt><dd>{labelFeature.current.depthPct ?? '—'} %WT</dd></div>
              <div>
                <dt>Remaining WT</dt>
                <dd>{labelFeature.current.remainingWtMm === null ? '—' : `${labelFeature.current.remainingWtMm.toFixed(1)} mm`}</dd>
              </div>
            </dl>
            {/* These are the measured dimensions. Say so whenever the box on the
                shell has been exaggerated, so the two are never confused. */}
            <p className="spool-scene__card-note">
              {view.markerScale === 1
                ? 'Measured size · axial length drawn 1:1'
                : `Measured size · drawn ×${view.markerScale} for visibility`}
            </p>
          </div>
        </Html>
      )}

      <CameraRig command={command} path={path} scale={scale} />
      {/* Close enough to sit on the wall and read one pit, far enough to see the
          whole spool — both bounded by the pipe's real size, not by a stage. */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={radius * 1.15}
        maxDistance={Math.max(path.extent * 8, radius * 40)}
      />
    </Canvas>
  );
}
