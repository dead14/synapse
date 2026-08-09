/**
 * The 3D spool preview in the girth-weld simulator.
 *
 * The scene is metric: one world unit is one metre, so a 12 m spool between two
 * girth welds is 12 units long and a 12" pipe is 0.3048 units across. An earlier
 * revision drew the shell at an arbitrary `od × 0.05` radius, which made a 12"
 * line look like a 24" one and put every on-screen proportion out by a factor
 * that changed with the diameter.
 *
 * Anomaly markers are exaggerated by {@link MARKER_SCALE} because real metal
 * loss is a few centimetres on a spool metres long and vanishes at true size.
 * That multiplier is display-only and is stated on screen; the pipe itself is
 * never exaggerated.
 */

import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Center } from '@react-three/drei';
import * as THREE from 'three';

interface Anomaly {
  /** Position along the spool, in metres from its upstream weld. */
  position: number;
  depthPct: number;
  /** 0 to 360 degrees, 0 being 12:00. */
  clockAngle: number;
  /** Axial length in millimetres, when the run reported one. */
  lengthMm?: number | null;
  /** Circumferential width in millimetres, when the run reported one. */
  widthMm?: number | null;
}

interface Pipeline3DViewerProps {
  /** Spool length in metres. */
  length?: number;
  /** Outside diameter in inches. */
  od?: number;
  anomalies?: Anomaly[];
}

const METRES_PER_INCH = 0.0254;
/** Display-only exaggeration for anomaly markers, stated in the overlay. */
const MARKER_SCALE = 4;
/** Drawn size for a defect reported without a length or a width. */
const NOMINAL_DEFECT_MM = 40;

function Pipe({ length = 12, od = 12, anomalies = [] }: Pipeline3DViewerProps) {
  const pipeRef = useRef<THREE.Mesh>(null);

  // True geometry: inches to metres for the girth, metres to metres for the run.
  const radius = (od * METRES_PER_INCH) / 2;
  const pipeLength = Math.max(length, 0.1);

  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      {/* Open pipe shell. The cylinder axis is local Y before the group is rotated. */}
      <mesh ref={pipeRef} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, pipeLength, 64, 1, true]} />
        <meshStandardMaterial
          color="#8a939e"
          metalness={0.8}
          roughness={0.2}
          side={THREE.DoubleSide}
          envMapIntensity={1.5}
        />
      </mesh>

      {/* End faces: the wall, drawn at a nominal 4 % of the radius. */}
      {[pipeLength / 2, -pipeLength / 2].map((endY) => (
        <mesh key={endY} position={[0, endY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 0.96, radius, 64]} />
          <meshStandardMaterial color="#667085" metalness={0.7} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Girth weld beads: a torus defaults to the Z axis, so rotate it to the pipe's Y axis. */}
      {[pipeLength / 2, -pipeLength / 2].map((endY) => (
        <mesh key={`weld-${endY}`} position={[0, endY, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[radius * 1.02, radius * 0.05, 16, 64]} />
          <meshStandardMaterial color="#4b5563" metalness={0.92} roughness={0.24} envMapIntensity={1.6} />
        </mesh>
      ))}

      {anomalies.map((anomaly, index) => {
        // The spool runs from -pipeLength/2 to +pipeLength/2 along local Y, and
        // `position` is already a distance in metres from the upstream weld.
        const yPos = Math.min(pipeLength, Math.max(0, anomaly.position)) - pipeLength / 2;

        const theta = (anomaly.clockAngle * Math.PI) / 180;
        const xPos = radius * Math.sin(theta);
        const zPos = radius * Math.cos(theta);

        // Reported millimetres, drawn in metres and exaggerated for visibility.
        const axial = ((anomaly.lengthMm ?? NOMINAL_DEFECT_MM) / 1000) * MARKER_SCALE;
        const circumferential = ((anomaly.widthMm ?? NOMINAL_DEFECT_MM) / 1000) * MARKER_SCALE;
        // Depth reads as height above the shell, so a deep pit stands out from a
        // shallow one at a glance.
        const radial = Math.max(radius * 0.02, (anomaly.depthPct / 100) * radius * 0.35);

        return (
          <mesh
            key={index}
            position={[xPos, yPos, zPos]}
            rotation={[Math.PI / 2, 0, -theta]}
          >
            <boxGeometry args={[circumferential, radial, axial]} />
            <meshStandardMaterial
              color="#ff3333"
              emissive="#aa0000"
              emissiveIntensity={0.5}
              roughness={0.3}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export default function Pipeline3DViewer({ length = 12, od = 12, anomalies = [] }: Pipeline3DViewerProps) {
  const safeLength = Math.max(length, 0.5);
  const radius = (od * METRES_PER_INCH) / 2;
  // Frame the spool by whichever dimension is larger; a long thin pipe is framed
  // by its run, a short stub by its girth.
  const cameraDistance = Math.max(safeLength * 0.9, radius * 12);

  return (
    <div className="w-full h-full min-h-[400px] bg-gradient-to-b from-gray-900 to-black rounded-xl overflow-hidden relative border border-gray-800">
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <h3 className="text-white font-bold text-lg drop-shadow-md">3D Pipeline Spool Explorer</h3>
        <p className="text-gray-400 text-sm">
          Spool length: {safeLength.toFixed(2)} m · OD {od}" ({(od * METRES_PER_INCH * 1000).toFixed(1)} mm)
        </p>
        <p className="text-[#ff3333] font-semibold text-sm mt-1">
          Detected metal loss: {anomalies.length}
        </p>
      </div>

      <div className="absolute bottom-4 left-4 z-10 pointer-events-none text-gray-500 text-xs">
        <p>Pipe drawn 1:1 · markers ×{MARKER_SCALE} for visibility</p>
        <p>Drag to rotate, scroll to zoom</p>
      </div>

      <Canvas
        camera={{
          position: [safeLength * 0.6, radius * 3, cameraDistance],
          fov: 42,
          near: Math.max(0.002, radius * 0.02),
          far: Math.max(200, safeLength * 40),
        }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#4466ff" />

        <Center>
          <Pipe length={safeLength} od={od} anomalies={anomalies} />
        </Center>
        <ContactShadows
          position={[0, -radius * 1.6, 0]}
          opacity={0.4}
          scale={Math.max(safeLength * 1.5, radius * 10)}
          blur={2}
          far={radius * 4}
        />

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          autoRotate={false}
          minDistance={radius * 1.2}
          maxDistance={Math.max(safeLength * 3, radius * 40)}
        />
      </Canvas>
    </div>
  );
}
