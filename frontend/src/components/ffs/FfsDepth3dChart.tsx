import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { buildDepthByLd } from '../../lib/ffs/chartData';
import type { DepthBucket } from '../../lib/ffs/statistics';
import type { FfsScreenedResult } from '../../lib/ffs/types';

/**
 * Feature counts by depth band and log distance, as a field of bars.
 *
 * The 2D stacked histogram beside this one remains the chart to read a number
 * off; a stacked bar is simply better at that. What it cannot show is the shape
 * of the whole surface at once — which bands run the length of the line and
 * which pile up in one stretch — because the bands are stacked on top of each
 * other rather than laid out side by side. Separating the bands onto their own
 * axis is what this view is for, so both are kept.
 *
 * The exact count is always one hover away, and the tallest bar in each band is
 * labelled, so the view never depends on the reader judging a height by eye.
 */

/** Plot extents in world units. Fixed, so the camera framing is predictable. */
const PLOT_WIDTH = 20;
const PLOT_DEPTH = 8;
const MAX_BAR_HEIGHT = 7;

export interface Depth3dHover {
  bandLabel: string;
  binLabel: string;
  count: number;
  color: string;
}

interface BarSpec {
  key: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  count: number;
  bandLabel: string;
  binLabel: string;
  /** Tallest bar of its band, so it carries a printed value. */
  labelled: boolean;
}

function Bar({
  spec,
  dimmed,
  onHover,
  onLeave,
}: {
  spec: BarSpec;
  dimmed: boolean;
  onHover: (hover: Depth3dHover) => void;
  onLeave: () => void;
}) {
  const [active, setActive] = useState(false);

  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setActive(true);
    onHover({
      bandLabel: spec.bandLabel,
      binLabel: spec.binLabel,
      count: spec.count,
      color: spec.color,
    });
  };

  const handleOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setActive(false);
    onLeave();
  };

  return (
    <group position={[spec.x, 0, spec.z]}>
      <mesh
        position={[0, spec.height / 2, 0]}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
        castShadow
      >
        <boxGeometry args={[spec.width, spec.height, spec.depth]} />
        <meshStandardMaterial
          color={spec.color}
          transparent
          opacity={dimmed && !active ? 0.25 : 1}
          emissive={active ? spec.color : '#000000'}
          emissiveIntensity={active ? 0.45 : 0}
          roughness={0.45}
          metalness={0.05}
        />
      </mesh>
      {(spec.labelled || active) && (
        <Text
          position={[0, spec.height + 0.42, 0]}
          fontSize={0.34}
          color={active ? '#0f172a' : '#64748b'}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.03}
          outlineColor="#ffffff"
        >
          {spec.count.toLocaleString()}
        </Text>
      )}
    </group>
  );
}

/** Ground plane, band labels, and the distance ticks along the front edge. */
function Stage({
  bands,
  distanceTicks,
  isDark,
}: {
  bands: { label: string; z: number; color: string }[];
  distanceTicks: { label: string; x: number }[];
  isDark: boolean;
}) {
  const labelColor = isDark ? '#cbd5e1' : '#475569';
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[PLOT_WIDTH + 3, PLOT_DEPTH + 3]} />
        <meshStandardMaterial color={isDark ? '#1e293b' : '#f1f5f9'} roughness={1} />
      </mesh>
      <gridHelper
        args={[
          Math.max(PLOT_WIDTH, PLOT_DEPTH) + 3,
          12,
          isDark ? '#475569' : '#cbd5e1',
          isDark ? '#334155' : '#e2e8f0',
        ]}
        position={[0, 0, 0]}
      />

      {bands.map((band) => (
        <Text
          key={band.label}
          position={[-PLOT_WIDTH / 2 - 0.8, 0.06, band.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.5}
          color={band.color}
          anchorX="right"
          anchorY="middle"
        >
          {band.label}
        </Text>
      ))}

      {distanceTicks.map((tick) => (
        <Text
          key={tick.label}
          position={[tick.x, 0.06, PLOT_DEPTH / 2 + 0.9]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.4}
          color={labelColor}
          anchorX="center"
          anchorY="middle"
        >
          {tick.label}
        </Text>
      ))}

      <Text
        position={[0, 0.06, PLOT_DEPTH / 2 + 2.1]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.45}
        color={labelColor}
        anchorX="center"
        anchorY="middle"
      >
        Log distance [m]
      </Text>
    </group>
  );
}

/** Slow orbit, paused whenever the pointer is over the plot. */
function AutoOrbit({ enabled }: { enabled: boolean }) {
  const { current: state } = useRef({ angle: 0 });
  useFrame((three, delta) => {
    if (!enabled) return;
    state.angle += delta * 0.12;
    const radius = 26;
    three.camera.position.x = Math.sin(state.angle) * radius;
    three.camera.position.z = Math.cos(state.angle) * radius;
    three.camera.lookAt(0, 2, 0);
  });
  return null;
}

export default function FfsDepth3dChart({
  items,
  binSizeM,
  buckets,
  surface,
  isDark,
  onCanvasReady,
}: {
  items: FfsScreenedResult[];
  binSizeM: number;
  buckets: DepthBucket[];
  surface?: 'internal' | 'external';
  isDark: boolean;
  /** Receives the WebGL canvas so the figure can be snapshotted for the report. */
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}) {
  const [hover, setHover] = useState<Depth3dHover | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(false);

  const data = useMemo(
    () => buildDepthByLd(items, binSizeM, buckets, surface),
    [items, binSizeM, buckets, surface],
  );

  const { bars, bands, distanceTicks, maxCount } = useMemo(() => {
    const binCount = data.labels.length;
    const bandCount = data.series.length;
    if (!binCount || !bandCount) {
      return { bars: [] as BarSpec[], bands: [], distanceTicks: [], maxCount: 0 };
    }

    const columnWidth = PLOT_WIDTH / binCount;
    const rowDepth = PLOT_DEPTH / bandCount;
    const highest = Math.max(1, ...data.series.flatMap((series) => series.data));

    const specs: BarSpec[] = [];
    data.series.forEach((series, bandIndex) => {
      const bandMax = Math.max(...series.data);
      // One printed value per band: its own tallest bar. Labelling every bar
      // turns the plot into a wall of numbers, and labelling none forces the
      // reader to estimate a height from a perspective projection.
      const labelIndex = series.data.indexOf(bandMax);
      series.data.forEach((count, binIndex) => {
        if (count <= 0) return;
        specs.push({
          key: `${bandIndex}-${binIndex}`,
          x: -PLOT_WIDTH / 2 + columnWidth * (binIndex + 0.5),
          z: -PLOT_DEPTH / 2 + rowDepth * (bandIndex + 0.5),
          width: columnWidth * 0.78,
          depth: rowDepth * 0.7,
          height: Math.max(0.08, (count / highest) * MAX_BAR_HEIGHT),
          color: series.color,
          count,
          bandLabel: series.label,
          binLabel: data.labels[binIndex],
          labelled: binIndex === labelIndex && bandMax > 0,
        });
      });
    });

    // At most eight ticks, so the front edge stays readable on a dense line.
    const step = Math.max(1, Math.ceil(binCount / 8));
    const ticks: { label: string; x: number }[] = [];
    for (let index = 0; index < binCount; index += step) {
      ticks.push({
        label: Math.round(data.bins[index].start).toLocaleString(),
        x: -PLOT_WIDTH / 2 + columnWidth * (index + 0.5),
      });
    }

    return {
      bars: specs,
      bands: data.series.map((series, bandIndex) => ({
        label: series.label,
        color: series.color,
        z: -PLOT_DEPTH / 2 + rowDepth * (bandIndex + 0.5),
      })),
      distanceTicks: ticks,
      maxCount: highest,
    };
  }, [data]);

  if (!bars.length) {
    return (
      <div className="grid h-full place-items-center text-xs text-slate-400">
        No feature falls in the configured depth bands.
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full"
      onPointerLeave={() => {
        setHover(null);
        setAutoOrbit(false);
      }}
      onPointerEnter={() => setAutoOrbit(false)}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 14, 22], fov: 45 }}
        // Without this the WebGL back buffer is cleared before the report
        // capture can read it, and the figure exports as a blank rectangle.
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onCreated={({ gl }) => onCanvasReady?.(gl.domElement)}
      >
        <color attach="background" args={[isDark ? '#0f172a' : '#ffffff']} />
        <ambientLight intensity={isDark ? 0.65 : 0.85} />
        <directionalLight position={[12, 18, 10]} intensity={1.1} castShadow />
        <directionalLight position={[-10, 8, -6]} intensity={0.35} />

        {/* Text glyphs are prepared asynchronously, and a suspending label must
            not be able to hold back the bars themselves — the plot is readable
            without its axis text, and unreadable without its geometry. */}
        <Suspense fallback={null}>
          <Stage bands={bands} distanceTicks={distanceTicks} isDark={isDark} />
        </Suspense>
        {bars.map((spec) => (
          <Suspense key={spec.key} fallback={null}>
            <Bar
              spec={spec}
              dimmed={hover !== null && hover.bandLabel !== spec.bandLabel}
              onHover={setHover}
              onLeave={() => setHover(null)}
            />
          </Suspense>
        ))}

        <AutoOrbit enabled={autoOrbit} />
        <OrbitControls
          enablePan
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={10}
          maxDistance={48}
          target={[0, 2, 0]}
        />
      </Canvas>

      {/* Readout. The plot is for shape; this is where the number comes from. */}
      <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-slate-200 bg-white/92 px-3 py-2 text-[11px] shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/92">
        {hover ? (
          <>
            <span className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: hover.color }}
              />
              {hover.bandLabel}
            </span>
            <span className="mt-0.5 block tabular-nums text-slate-500 dark:text-slate-400">
              {hover.binLabel} m
            </span>
            <span className="mt-0.5 block text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {hover.count.toLocaleString()} feature{hover.count === 1 ? '' : 's'}
            </span>
          </>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">
            Hover a bar for its count · drag to orbit · scroll to zoom
          </span>
        )}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-slate-200 bg-white/92 px-3 py-2 text-[10px] tabular-nums text-slate-500 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/92 dark:text-slate-400">
        Tallest bar = {maxCount.toLocaleString()}
      </div>
    </div>
  );
}
