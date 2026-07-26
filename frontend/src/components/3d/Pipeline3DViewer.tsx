import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Center } from '@react-three/drei';
import * as THREE from 'three';

interface Anomaly {
  position: number; // Position along the spool (0 to length)
  depthPct: number; // 0 to 100
  clockAngle: number; // 0 to 360 (degrees)
}

interface Pipeline3DViewerProps {
  length?: number; // length of the spool in meters (e.g. 12m)
  od?: number; // Outer Diameter in inches
  anomalies?: Anomaly[];
}

function Pipe({ length = 12, od = 12, anomalies = [] }: Pipeline3DViewerProps) {
  const pipeRef = useRef<THREE.Mesh>(null);
  
  // Convert OD in inches to an arbitrary 3D scale (e.g., 1 inch = 0.05 units)
  const radius = (od * 0.05) / 2;
  // Convert length in meters to arbitrary 3D scale (e.g., 1m = 1 unit)
  const pipeLength = length;

  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      {/* Open pipe shell.  The cylinder axis is local Y before the group is rotated. */}
      <mesh ref={pipeRef} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, pipeLength, 64, 1, true]} />
        <meshStandardMaterial 
          color="#8a939e" 
          metalness={0.8} 
          roughness={0.2} 
          envMapIntensity={1.5}
        />
      </mesh>

      {/* End faces: ring geometry is rotated onto the pipe's Y axis. */}
      {[pipeLength / 2, -pipeLength / 2].map((endY) => (
        <mesh key={endY} position={[0, endY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 0.78, radius, 64]} />
          <meshStandardMaterial color="#667085" metalness={0.7} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Girth weld beads: a torus defaults to the Z axis, so rotate it to the pipe's Y axis. */}
      {[pipeLength / 2, -pipeLength / 2].map((endY) => (
        <mesh key={`weld-${endY}`} position={[0, endY, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[radius + radius * 0.025, Math.max(radius * 0.1, 0.025), 16, 64]} />
          <meshStandardMaterial color="#4b5563" metalness={0.92} roughness={0.24} envMapIntensity={1.6} />
        </mesh>
      ))}

      {/* Anomalies */}
      {anomalies.map((anomaly, index) => {
        // Calculate position along the cylinder
        // Y goes from -pipeLength/2 to pipeLength/2
        const yPos = (anomaly.position / length) * pipeLength - (pipeLength / 2);
        
        // Convert clock angle to radians
        const theta = (anomaly.clockAngle * Math.PI) / 180;
        
        // X and Z position on the surface of the cylinder
        const xPos = radius * Math.sin(theta);
        const zPos = radius * Math.cos(theta);

        // Size of the anomaly dot based on depth (just for visualization)
        const dotSize = Math.max(0.05, anomaly.depthPct * 0.002);

        return (
          <mesh 
            key={index} 
            position={[xPos, yPos, zPos]} 
            rotation={[Math.PI / 2, 0, -theta]}
          >
            <sphereGeometry args={[dotSize, 16, 16]} />
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

export default function Pipeline3DViewer({ length = 12, od = 12, anomalies = [] }: Pipeline3DViewerProps & { anomalies?: { position: number, depthPct: number, clockAngle: number }[] }) {
  const safeLength = Math.max(length, 0.5);
  const cameraDistance = Math.max(5, safeLength * 0.9);

  return (
    <div className="w-full h-full min-h-[400px] bg-gradient-to-b from-gray-900 to-black rounded-xl overflow-hidden relative border border-gray-800">
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <h3 className="text-white font-bold text-lg drop-shadow-md">3D Pipeline Spool Explorer</h3>
        <p className="text-gray-400 text-sm">Spool Length: {length.toFixed(2)}m | OD: {od}"</p>
        <p className="text-[#ff3333] font-semibold text-sm mt-1">
          Detected Metal Loss: {anomalies.length}
        </p>
      </div>
      
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none text-gray-500 text-xs">
        *Drag to rotate, Scroll to zoom
      </div>

      <Canvas camera={{ position: [safeLength * 0.6, safeLength * 0.16, cameraDistance], fov: 42 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#4466ff" />
        
        <Center>
          <Pipe length={safeLength} od={od} anomalies={anomalies} />
        </Center>
        <ContactShadows position={[0, -1.5, 0]} opacity={0.4} scale={20} blur={2} far={4} />
        
        <OrbitControls 
          enablePan={true} 
          enableZoom={true} 
          enableRotate={true}
          autoRotate={false}
          minDistance={2}
          maxDistance={Math.max(12, safeLength * 2)}
        />
      </Canvas>
    </div>
  );
}
