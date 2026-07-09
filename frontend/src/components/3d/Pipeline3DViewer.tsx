import React from 'react';
import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Text, Center } from '@react-three/drei';
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
      {/* Main Pipe Cylinder */}
      <mesh ref={pipeRef} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, pipeLength, 64]} />
        <meshStandardMaterial 
          color="#8a939e" 
          metalness={0.8} 
          roughness={0.2} 
          envMapIntensity={1.5}
        />
      </mesh>

      {/* Internal Pipe (Hollow effect at ends) */}
      <mesh position={[0, pipeLength / 2 + 0.01, 0]}>
        <circleGeometry args={[radius * 0.9, 32]} />
        <meshBasicMaterial color="#111" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -pipeLength / 2 - 0.01, 0]}>
        <circleGeometry args={[radius * 0.9, 32]} />
        <meshBasicMaterial color="#111" side={THREE.DoubleSide} />
      </mesh>

      {/* Weld marks at the ends */}
      <mesh position={[0, pipeLength / 2, 0]}>
        <torusGeometry args={[radius, 0.02, 16, 64]} />
        <meshStandardMaterial color="#666" metalness={0.9} roughness={0.4} />
      </mesh>
      <mesh position={[0, -pipeLength / 2, 0]}>
        <torusGeometry args={[radius, 0.02, 16, 64]} />
        <meshStandardMaterial color="#666" metalness={0.9} roughness={0.4} />
      </mesh>

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

      <Canvas camera={{ position: [0, 2, 5], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#4466ff" />
        
        <React.Suspense fallback={null}>
          <Center>
            <Pipe length={length} od={od} anomalies={anomalies} />
          </Center>
          <Environment preset="city" />
          <ContactShadows position={[0, -1.5, 0]} opacity={0.4} scale={20} blur={2} far={4} />
        </React.Suspense>
        
        <OrbitControls 
          enablePan={true} 
          enableZoom={true} 
          enableRotate={true}
          autoRotate={true}
          autoRotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
}
