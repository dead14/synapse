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
 * - Anomaly patches are drawn as tangent planes on the shell, sized from the
 *   reported length (axial) and width (circumferential). The width is a true
 *   arc only when an outside diameter is supplied; without one the patch keeps
 *   a nominal arc and the view says so rather than implying a measurement.
 *
 * Marker scale is a display multiplier, never a data change. Real ILI defects
 * on a 12 m spool are a few centimetres across and vanish at true scale, so the
 * pane exaggerates by default and states the factor on screen.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Line, Text, Html } from '@react-three/drei';
import * as THREE from 'three';

import {
  arcWidthDeg,
  type SpoolFeature,
} from '../../domain/spoolFeatures.ts';
import { depthRgb, STATUS_COLOR, type DepthPalette } from './spoolPalette.ts';
import { axialTicks } from './spoolScale.ts';
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

const RADIUS = 2.0;
const NOMINAL_ARC_DEG = 8;
const MIN_PATCH = 0.05;
/** Long-radius elbow: 1.5 diameters, the default for transmission pipe. */
const BEND_RADIUS_FACTOR = 3;
const SHELL_SEGMENTS = 64;

function worldLength(spanM: number): number {
  return Math.min(40, Math.max(10, spanM * 1.2));
}

function vec(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

/** Outward surface direction at a clock angle, in the frame's own basis. */
function surfaceNormal(frame: PathFrame, angleRad: number): THREE.Vector3 {
  return vec(frame.up).multiplyScalar(Math.cos(angleRad))
    .addScaledVector(vec(frame.right), Math.sin(angleRad));
}

/** Basis for a tangent patch on the shell at (frame, clock angle). */
function patchMatrix(
  frame: PathFrame,
  angleRad: number,
  axialSize: number,
  circSize: number,
  radius: number,
): THREE.Matrix4 {
  const normal = surfaceNormal(frame, angleRad);
  const axial = vec(frame.tangent).multiplyScalar(axialSize);
  const circumferential = vec(frame.up).multiplyScalar(Math.sin(angleRad))
    .addScaledVector(vec(frame.right), -Math.cos(angleRad))
    .multiplyScalar(circSize);
  const matrix = new THREE.Matrix4().makeBasis(axial, circumferential, normal);
  matrix.setPosition(vec(frame.origin).addScaledVector(normal, radius));
  return matrix;
}

/** Cross-section basis: local XY is the pipe's cross-section plane. */
function ringMatrix(frame: PathFrame, offset = 0): THREE.Matrix4 {
  const matrix = new THREE.Matrix4().makeBasis(vec(frame.up), vec(frame.right), vec(frame.tangent));
  matrix.setPosition(vec(frame.origin).addScaledVector(vec(frame.tangent), offset));
  return matrix;
}

interface PlacedPatch {
  feature: SpoolFeature;
  matrix: THREE.Matrix4;
  color: THREE.Color;
  corners: Array<[number, number, number]>;
  anchor: [number, number, number];
}

function placeFeatures(
  features: SpoolFeature[],
  side: 'current' | 'previous',
  path: SpoolPath,
  spanM: number,
  odMm: number | null,
  palette: DepthPalette,
  markerScale: number,
): PlacedPatch[] {
  const worldPerM = path.length / spanM;
  const radius = side === 'current' ? RADIUS * 1.004 : RADIUS * 1.001;
  const placed: PlacedPatch[] = [];

  features.forEach((feature) => {
    const data = feature[side];
    if (!data.present) return;
    const maM = data.maM ?? feature.maM;
    const clockDeg = data.clockDeg ?? feature.clockDeg;
    const angle = (clockDeg * Math.PI) / 180;
    const frame = path.frameAt(maM);

    const axialWorld = data.lengthMm === null
      ? MIN_PATCH * 2
      : Math.max(MIN_PATCH, (data.lengthMm / 1000) * worldPerM * markerScale);
    // Exaggerate a real arc, never the nominal fallback: multiplying a made-up
    // width is what smears the patches into circumferential streaks.
    const trueArc = arcWidthDeg(data.widthMm, odMm);
    const arcDeg = trueArc === null ? NOMINAL_ARC_DEG : trueArc * markerScale;
    const circWorld = Math.max(MIN_PATCH, (arcDeg * Math.PI / 180) * radius);

    const matrix = patchMatrix(frame, angle, axialWorld, circWorld, radius);
    const [r, g, b] = side === 'current'
      ? depthRgb(data.depthPct, palette)
      : [120, 130, 148];

    const corner = (dx: number, dy: number): [number, number, number] => {
      const point = new THREE.Vector3(dx, dy, 0.02).applyMatrix4(matrix);
      return [point.x, point.y, point.z];
    };
    const anchorPoint = vec(frame.origin)
      .addScaledVector(surfaceNormal(frame, angle), radius * 1.02);

    placed.push({
      feature,
      matrix,
      color: new THREE.Color(r / 255, g / 255, b / 255),
      corners: [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5), corner(-0.5, -0.5)],
      anchor: [anchorPoint.x, anchorPoint.y, anchorPoint.z],
    });
  });

  return placed;
}

// ─── Shell ──────────────────────────────────────────────────────────────────

/**
 * The shell, swept along the centreline. It is built here rather than with
 * TubeGeometry because the cutaway has to open the pipe along a theta range,
 * and because the sweep must use the same frames the patches are placed with —
 * a shell and a defect drawn from two different frames is exactly the drift
 * this workspace exists to prevent.
 */
function useShellGeometry(path: SpoolPath, cutaway: boolean): THREE.BufferGeometry {
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
        const point = vec(frame.origin).addScaledVector(normal, RADIUS);
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
  }, [path, cutaway]);
}

function PipeShell({
  path,
  welds,
  view,
  clippingPlanes,
}: {
  path: SpoolPath;
  welds: Array<{ id: string; maM: number }>;
  view: SceneViewOptions;
  clippingPlanes: THREE.Plane[];
}) {
  const geometry = useShellGeometry(path, view.cutaway);
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
          <torusGeometry args={[RADIUS * 1.008, RADIUS * 0.028, 12, 72]} />
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
  fittings,
  worldPerM,
  clippingPlanes,
}: {
  path: SpoolPath;
  fittings: SpoolFitting[];
  worldPerM: number;
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
          ).setPosition(vec(frame.origin).addScaledVector(stem, RADIUS * 2.3));
          return (
            <group key={fitting.key}>
              <mesh matrixAutoUpdate={false} matrix={body}>
                <cylinderGeometry args={[RADIUS * 1.35, RADIUS * 1.35, RADIUS * 1.1, 24, 1, false]} />
                <meshStandardMaterial color="#a855f7" metalness={0.5} roughness={0.4} transparent opacity={0.42} clippingPlanes={clippingPlanes} />
              </mesh>
              <mesh
                matrixAutoUpdate={false}
                matrix={new THREE.Matrix4().makeBasis(
                  vec(frame.tangent), stem, new THREE.Vector3().crossVectors(vec(frame.tangent), stem),
                ).setPosition(vec(frame.origin).addScaledVector(stem, RADIUS * 1.6))}
              >
                <cylinderGeometry args={[RADIUS * 0.09, RADIUS * 0.09, RADIUS * 1.6, 12]} />
                <meshStandardMaterial color="#c4b5fd" metalness={0.6} roughness={0.35} clippingPlanes={clippingPlanes} />
              </mesh>
              <mesh matrixAutoUpdate={false} matrix={wheel}>
                <torusGeometry args={[RADIUS * 0.45, RADIUS * 0.06, 10, 32]} />
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
                matrix={basis.clone().setPosition(vec(frame.origin).addScaledVector(branch, RADIUS * 0.9))}
              >
                <cylinderGeometry args={[RADIUS * 0.55, RADIUS * 0.55, RADIUS * 1.8, 20, 1, true]} />
                <meshStandardMaterial color="#38bdf8" metalness={0.35} roughness={0.5} side={THREE.DoubleSide} transparent opacity={0.5} clippingPlanes={clippingPlanes} />
              </mesh>
              <mesh
                matrixAutoUpdate={false}
                matrix={basis.clone().setPosition(vec(frame.origin).addScaledVector(branch, RADIUS * 1.8))}
              >
                <cylinderGeometry args={[RADIUS * 0.75, RADIUS * 0.75, RADIUS * 0.12, 20]} />
                <meshStandardMaterial color="#7dd3fc" metalness={0.5} roughness={0.4} clippingPlanes={clippingPlanes} />
              </mesh>
            </group>
          );
        }

        if (fitting.kind === 'flange') {
          return (
            <mesh key={fitting.key} matrixAutoUpdate={false} matrix={ringMatrix(frame)}>
              <torusGeometry args={[RADIUS * 1.12, RADIUS * 0.12, 12, 40]} />
              <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.35} clippingPlanes={clippingPlanes} />
            </mesh>
          );
        }

        if (fitting.kind !== 'bend' || fitting.angleDeg === null) return null;
        // A bend is the shell itself; what is drawn here is where it starts and
        // ends, so the reviewer can see which metal is in the curve.
        const halfArcM = bendArcLength(fitting.angleDeg, RADIUS * BEND_RADIUS_FACTOR) / 2 / worldPerM;
        return (
          <group key={fitting.key}>
            {[-halfArcM, halfArcM].map((offset, index) => (
              <mesh
                key={index}
                matrixAutoUpdate={false}
                matrix={ringMatrix(path.frameAt(fitting.maM + offset))}
              >
                <torusGeometry args={[RADIUS * 1.02, RADIUS * 0.035, 10, 48]} />
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
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    roughness: 0.5,
    metalness: 0.1,
    transparent: opacity < 1,
    opacity,
  }), [opacity]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = placed.length;
    placed.forEach((patch, index) => {
      mesh.setMatrixAt(index, patch.matrix);
      mesh.setColorAt(index, patch.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placed]);

  if (placed.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, placed.length]}
      onPointerOver={interactive ? (event) => {
        event.stopPropagation();
        document.body.style.cursor = 'pointer';
        onHover?.(placed[event.instanceId ?? -1]?.feature ?? null);
      } : undefined}
      onPointerOut={interactive ? (event) => {
        event.stopPropagation();
        document.body.style.cursor = 'default';
        onHover?.(null);
      } : undefined}
      onClick={interactive ? (event) => {
        event.stopPropagation();
        const patch = placed[event.instanceId ?? -1];
        if (patch && onPick) onPick(patch.feature, event);
      } : undefined}
    />
  );
}

// ─── Decorations ────────────────────────────────────────────────────────────

/** The ruler follows the pipe, so it still reads under a bent spool. */
function AxialRuler({ path, startM, endM }: { path: SpoolPath; startM: number; endM: number }) {
  const offset = -RADIUS * 1.85;
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
  const label = vec(midpoint.origin).addScaledVector(vec(midpoint.up), offset - 0.78);

  return (
    <group>
      <Line points={rail} color="#7c8899" lineWidth={1} />
      {ticks.map(({ m, frame }) => {
        const base = vec(frame.origin).addScaledVector(vec(frame.up), offset);
        const top = vec(frame.origin).addScaledVector(vec(frame.up), offset + 0.16);
        const text = vec(frame.origin).addScaledVector(vec(frame.up), offset - 0.32);
        return (
          <group key={m}>
            <Line points={[[base.x, base.y, base.z], [top.x, top.y, top.z]]} color="#94a3b8" lineWidth={1} />
            <Text position={[text.x, text.y, text.z]} fontSize={0.26} color="#cbd5e1" anchorX="center" anchorY="middle">
              {`${Number.isInteger(m) ? m : m.toFixed(1)} m`}
            </Text>
          </group>
        );
      })}
      <Text position={[label.x, label.y, label.z]} fontSize={0.28} color="#94a3b8" anchorX="center" anchorY="middle">
        Master Axis (m)
      </Text>
    </group>
  );
}

function ClockRing({ frame }: { frame: PathFrame }) {
  const points = useMemo(() => {
    const ring: Array<[number, number, number]> = [];
    for (let step = 0; step <= 72; step += 1) {
      const angle = (step / 72) * Math.PI * 2;
      const point = vec(frame.origin)
        .addScaledVector(surfaceNormal(frame, angle), RADIUS * 1.12)
        .addScaledVector(vec(frame.tangent), 0.05);
      ring.push([point.x, point.y, point.z]);
    }
    return ring;
  }, [frame]);

  const labels: Array<[string, number]> = [['12:00', 0], ['3:00', 90], ['6:00', 180], ['9:00', 270]];

  return (
    <group>
      <Line points={points} color="#cbd5e1" lineWidth={1} dashed dashSize={0.12} gapSize={0.1} />
      {labels.map(([label, deg]) => {
        const angle = (deg * Math.PI) / 180;
        const point = vec(frame.origin)
          .addScaledVector(surfaceNormal(frame, angle), RADIUS * 1.34)
          .addScaledVector(vec(frame.tangent), 0.1);
        return (
          <Text
            key={label}
            position={[point.x, point.y, point.z]}
            fontSize={0.3}
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

function CrossSectionRing({ frame }: { frame: PathFrame }) {
  const points = useMemo(() => {
    const ring: Array<[number, number, number]> = [];
    for (let step = 0; step <= 96; step += 1) {
      const angle = (step / 96) * Math.PI * 2;
      const point = vec(frame.origin).addScaledVector(surfaceNormal(frame, angle), RADIUS);
      ring.push([point.x, point.y, point.z]);
    }
    return ring;
  }, [frame]);
  return <Line points={points} color="#f8fafc" lineWidth={2} />;
}

// ─── Camera ─────────────────────────────────────────────────────────────────

function CameraRig({ command, path }: { command: CameraCommand; path: SpoolPath }) {
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
    const forLength = (path.extentAxial + RADIUS) / Math.tan(hFov / 2);
    const forGirth = (path.extentLateral + RADIUS * 1.9) / Math.tan(vFov / 2);
    const distance = Math.max(forLength, forGirth) * 1.06;
    // Down the axis only the diameter has to fit, so that view sits far closer.
    const axialDistance = Math.max(forGirth * 0.6, RADIUS * 4);

    const directions: Record<CameraPreset, [number, number, number, number]> = {
      home: [0.44, 0.32, 0.84, distance],
      top: [0.001, 1, 0.002, distance],
      bottom: [0.001, -1, 0.002, distance],
      right: [0.002, 0.001, 1, distance],
      left: [0.002, 0.001, -1, distance],
      'look-along': [-1, 0.08, 0.002, axialDistance],
    };
    const positions = Object.fromEntries(
      Object.entries(directions).map(([preset, [x, y, z, radius]]) => {
        const direction = new THREE.Vector3(x, y, z).normalize().multiplyScalar(radius);
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
      const clamped = Math.min(Math.max(next.length(), path.extent * 0.36), path.extent * 8);
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
  const length = worldLength(spanM);
  const worldPerM = length / spanM;

  const path = useMemo(
    () => buildSpoolPath(startM, endM, worldPerM, fittings
      .filter((fitting) => fitting.kind === 'bend' && fitting.angleDeg !== null)
      .map((fitting) => ({
        key: fitting.key,
        maM: fitting.maM,
        angleDeg: fitting.angleDeg as number,
        rollDeg: fitting.rollDeg,
        radius: RADIUS * BEND_RADIUS_FACTOR,
      }))),
    [startM, endM, worldPerM, fittings],
  );

  const currentPatches = useMemo(
    () => placeFeatures(features, 'current', path, spanM, odMm, palette, view.markerScale),
    [features, path, spanM, odMm, palette, view.markerScale],
  );

  const previousPatches = useMemo(
    () => (view.showPrevious
      ? placeFeatures(
        features.filter((feature) => feature.previous.present),
        'previous', path, spanM, odMm, palette, view.markerScale,
      )
      : []),
    [features, view.showPrevious, path, spanM, odMm, palette, view.markerScale],
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
      camera={{ position: [length * 0.42, RADIUS * 2.6, length * 0.75], fov: 42, near: 0.1, far: 500 }}
      gl={{ localClippingEnabled: true, antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => { if (!measureMode) onSelect(null); }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[8, 14, 10]} intensity={1.35} />
      <directionalLight position={[-10, -6, -8]} intensity={0.45} color="#93c5fd" />

      <PipeShell path={path} welds={welds} view={view} clippingPlanes={clippingPlanes} />
      {view.showFittings && (
        <FittingBodies
          path={path}
          fittings={fittings}
          worldPerM={worldPerM}
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
        <Line points={selectedPatch.corners} color="#ffffff" lineWidth={2} dashed dashSize={0.09} gapSize={0.07} />
      )}
      {view.crossSection && crossSectionFrame && <CrossSectionRing frame={crossSectionFrame} />}
      {measurePoints.length === 2 && (
        <Line points={measurePoints} color="#fbbf24" lineWidth={2} />
      )}

      <AxialRuler path={path} startM={startM} endM={endM} />
      <ClockRing frame={path.frameAt(endM)} />

      {labelFeature && labelPatch && (
        <Html position={labelPatch.anchor} distanceFactor={length * 0.9} zIndexRange={[40, 0]}>
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
          </div>
        </Html>
      )}

      <CameraRig command={command} path={path} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={path.extent * 0.3} maxDistance={path.extent * 8} />
    </Canvas>
  );
}
