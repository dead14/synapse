/**
 * The 3D pipe pane of the Spool Detail View.
 *
 * Geometry conventions, fixed here and relied on by every other pane:
 *
 * - The pipe axis runs along world X. `maM` maps linearly onto it, so the axial
 *   ruler under the pipe and the unrolled view below share one scale.
 * - Clock 12:00 is +Y (up) and the angle increases towards +Z, which puts 3:00
 *   on the right when the camera sits downstream. The clock ring at the far end
 *   labels it so nobody has to take that on trust.
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

export type CameraPreset = 'home' | 'top' | 'bottom' | 'left' | 'right' | 'look-along';

export interface SceneViewOptions {
  xray: boolean;
  cutaway: boolean;
  crossSection: boolean;
  markerScale: number;
  showPrevious: boolean;
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

function worldLength(spanM: number): number {
  return Math.min(40, Math.max(10, spanM * 1.2));
}


/** Basis for a tangent patch on the shell at (axial x, clock angle). */
function patchMatrix(
  x: number,
  angleRad: number,
  axialSize: number,
  circSize: number,
  radius: number,
): THREE.Matrix4 {
  const normal = new THREE.Vector3(0, Math.cos(angleRad), Math.sin(angleRad));
  const axial = new THREE.Vector3(1, 0, 0).multiplyScalar(axialSize);
  const circumferential = new THREE.Vector3(0, Math.sin(angleRad), -Math.cos(angleRad)).multiplyScalar(circSize);
  const matrix = new THREE.Matrix4().makeBasis(axial, circumferential, normal);
  matrix.setPosition(x, normal.y * radius, normal.z * radius);
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
  startM: number,
  spanM: number,
  length: number,
  odMm: number | null,
  palette: DepthPalette,
  markerScale: number,
): PlacedPatch[] {
  const worldPerM = length / spanM;
  const radius = side === 'current' ? RADIUS * 1.004 : RADIUS * 1.001;
  const placed: PlacedPatch[] = [];

  features.forEach((feature) => {
    const data = feature[side];
    if (!data.present) return;
    const maM = data.maM ?? feature.maM;
    const clockDeg = data.clockDeg ?? feature.clockDeg;
    const angle = (clockDeg * Math.PI) / 180;
    const x = (maM - startM) * worldPerM - length / 2;

    const axialWorld = data.lengthMm === null
      ? MIN_PATCH * 2
      : Math.max(MIN_PATCH, (data.lengthMm / 1000) * worldPerM * markerScale);
    // Exaggerate a real arc, never the nominal fallback: multiplying a made-up
    // width is what smears the patches into circumferential streaks.
    const trueArc = arcWidthDeg(data.widthMm, odMm);
    const arcDeg = trueArc === null ? NOMINAL_ARC_DEG : trueArc * markerScale;
    const circWorld = Math.max(MIN_PATCH, (arcDeg * Math.PI / 180) * radius);

    const matrix = patchMatrix(x, angle, axialWorld, circWorld, radius);
    const [r, g, b] = side === 'current'
      ? depthRgb(data.depthPct, palette)
      : [120, 130, 148];

    const corner = (dx: number, dy: number): [number, number, number] => {
      const point = new THREE.Vector3(dx, dy, 0.02).applyMatrix4(matrix);
      return [point.x, point.y, point.z];
    };

    placed.push({
      feature,
      matrix,
      color: new THREE.Color(r / 255, g / 255, b / 255),
      corners: [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5), corner(-0.5, -0.5)],
      anchor: [x, Math.cos(angle) * radius * 1.02, Math.sin(angle) * radius * 1.02],
    });
  });

  return placed;
}

// ─── Shell ──────────────────────────────────────────────────────────────────

function PipeShell({
  length,
  welds,
  startM,
  spanM,
  view,
  crossSectionX,
}: {
  length: number;
  welds: Array<{ id: string; maM: number }>;
  startM: number;
  spanM: number;
  view: SceneViewOptions;
  crossSectionX: number | null;
}) {
  const clippingPlanes = useMemo(() => (
    view.crossSection && crossSectionX !== null
      ? [new THREE.Plane(new THREE.Vector3(-1, 0, 0), crossSectionX)]
      : []
  ), [view.crossSection, crossSectionX]);

  // A cutaway keeps the far half of the shell so the inside surface — and any
  // internal metal loss sitting on it — stays visible from the default camera.
  const thetaLength = view.cutaway ? Math.PI : Math.PI * 2;
  const worldPerM = length / spanM;

  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[RADIUS, RADIUS, length, 96, 1, true, view.cutaway ? Math.PI / 2 : 0, thetaLength]} />
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
      {welds.map((weld) => {
        const x = (weld.maM - startM) * worldPerM - length / 2;
        if (x < -length / 2 - 0.01 || x > length / 2 + 0.01) return null;
        return (
          <mesh key={weld.id} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[RADIUS * 1.008, RADIUS * 0.028, 12, 72]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.35} clippingPlanes={clippingPlanes} />
          </mesh>
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

function AxialRuler({ startM, endM, length }: { startM: number; endM: number; length: number }) {
  const ticks = useMemo(() => {
    const span = endM - startM;
    return axialTicks(startM, endM).map((m) => ({ m, x: ((m - startM) / span) * length - length / 2 }));
  }, [startM, endM, length]);

  const y = -RADIUS * 1.85;

  return (
    <group>
      <Line points={[[-length / 2, y, 0], [length / 2, y, 0]]} color="#7c8899" lineWidth={1} />
      {ticks.map((tick) => (
        <group key={tick.m}>
          <Line points={[[tick.x, y, 0], [tick.x, y + 0.16, 0]]} color="#94a3b8" lineWidth={1} />
          <Text position={[tick.x, y - 0.32, 0]} fontSize={0.26} color="#cbd5e1" anchorX="center" anchorY="middle">
            {`${Number.isInteger(tick.m) ? tick.m : tick.m.toFixed(1)} m`}
          </Text>
        </group>
      ))}
      <Text position={[0, y - 0.78, 0]} fontSize={0.28} color="#94a3b8" anchorX="center" anchorY="middle">
        Master Axis (m)
      </Text>
    </group>
  );
}

function ClockRing({ length }: { length: number }) {
  const x = length / 2 + 0.05;
  const points = useMemo(() => {
    const ring: Array<[number, number, number]> = [];
    for (let step = 0; step <= 72; step += 1) {
      const angle = (step / 72) * Math.PI * 2;
      ring.push([x, Math.cos(angle) * RADIUS * 1.12, Math.sin(angle) * RADIUS * 1.12]);
    }
    return ring;
  }, [x]);

  const labels: Array<[string, number]> = [['12:00', 0], ['3:00', 90], ['6:00', 180], ['9:00', 270]];

  return (
    <group>
      <Line points={points} color="#cbd5e1" lineWidth={1} dashed dashSize={0.12} gapSize={0.1} />
      {labels.map(([label, deg]) => {
        const angle = (deg * Math.PI) / 180;
        return (
          <Text
            key={label}
            position={[x + 0.05, Math.cos(angle) * RADIUS * 1.34, Math.sin(angle) * RADIUS * 1.34]}
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

function CrossSectionRing({ x }: { x: number }) {
  const points = useMemo(() => {
    const ring: Array<[number, number, number]> = [];
    for (let step = 0; step <= 96; step += 1) {
      const angle = (step / 96) * Math.PI * 2;
      ring.push([x, Math.cos(angle) * RADIUS, Math.sin(angle) * RADIUS]);
    }
    return ring;
  }, [x]);
  return <Line points={points} color="#f8fafc" lineWidth={2} />;
}

// ─── Camera ─────────────────────────────────────────────────────────────────

function CameraRig({ command, length }: { command: CameraCommand; length: number }) {
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
    const forLength = (length / 2) / Math.tan(hFov / 2);
    const forGirth = (RADIUS * 1.9) / Math.tan(vFov / 2);
    const distance = Math.max(forLength, forGirth) * 1.06;
    // Down the axis only the diameter has to fit, so that view sits far closer.
    const axialDistance = Math.max(forGirth * 1.5, RADIUS * 4);

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
      const clamped = Math.min(Math.max(next.length(), length * 0.18), length * 4);
      camera.position.copy(target.clone().add(next.setLength(clamped)));
    } else {
      const [x, y, z] = positions[command.preset];
      camera.position.set(x, y, z);
      controls.target.set(0, 0, 0);
    }
    camera.updateProjectionMatrix();
    controls.update();
  }, [camera, controls, command, length]);

  return null;
}

// ─── Pane ───────────────────────────────────────────────────────────────────

export default function SpoolScene3D({
  features,
  welds,
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

  const currentPatches = useMemo(
    () => placeFeatures(features, 'current', startM, spanM, length, odMm, palette, view.markerScale),
    [features, startM, spanM, length, odMm, palette, view.markerScale],
  );

  const previousPatches = useMemo(
    () => (view.showPrevious
      ? placeFeatures(
        features.filter((feature) => feature.previous.present),
        'previous', startM, spanM, length, odMm, palette, view.markerScale,
      )
      : []),
    [features, view.showPrevious, startM, spanM, length, odMm, palette, view.markerScale],
  );

  const selectedPatch = currentPatches.find((patch) => patch.feature.key === selectedKey)
    ?? previousPatches.find((patch) => patch.feature.key === selectedKey)
    ?? null;
  const hoveredPatch = hovered
    ? currentPatches.find((patch) => patch.feature.key === hovered.key) ?? null
    : null;
  const labelPatch = hoveredPatch ?? selectedPatch;
  const labelFeature = labelPatch?.feature ?? null;

  const crossSectionX = selectedPatch
    ? (selectedPatch.feature.maM - startM) * (length / spanM) - length / 2
    : null;

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

      <PipeShell
        length={length}
        welds={welds}
        startM={startM}
        spanM={spanM}
        view={view}
        crossSectionX={crossSectionX}
      />

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
      {view.crossSection && crossSectionX !== null && <CrossSectionRing x={crossSectionX} />}
      {measurePoints.length === 2 && (
        <Line points={measurePoints} color="#fbbf24" lineWidth={2} />
      )}

      <AxialRuler startM={startM} endM={endM} length={length} />
      <ClockRing length={length} />

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

      <CameraRig command={command} length={length} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={length * 0.15} maxDistance={length * 4} />
    </Canvas>
  );
}
