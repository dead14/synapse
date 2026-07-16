import React from 'react';
import { useState, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { FiBox, FiX } from 'react-icons/fi';
import { apiFetch } from './utils/api';

interface DefectVisualizerProps {
  data: any[];
  selectedRowIdx?: number | null;
  onSelectRowIdx?: (idx: number | null) => void;
}

const FEAPipeMesh = ({ renderLength, sLength, startDist, spoolData, gwList }: { renderLength: number, sLength: number, startDist: number, spoolData: any[], gwList: number[] }) => {
  const geom = useMemo(() => {
    const segments = 64;
    const padding = 2.0;
    const actualPipeLength = renderLength + (padding * 2);
    const heightSegments = Math.max(10, Math.ceil(actualPipeLength * 10));
    const pipeRadius = 2.0;
    const geometry = new THREE.CylinderGeometry(pipeRadius, pipeRadius, actualPipeLength, segments, heightSegments, true);
    
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    
    // Weld bead parameters (realistic proportions)
    const weldHalfWidth = 0.15; // Half-width of weld bead in real meters (~15cm total width)
    const weldBulgeHeight = 0.06; // Max radial bulge height (6cm cap reinforcement)
    
    for (let i = 0; i < pos.count; i++) {
      let vx = pos.getX(i);
      const vy = pos.getY(i);
      let vz = pos.getZ(i);
      
      // Default Base Pipe Color
      color.set('#38bdf8');
      
      // Map vertex Y back to real pipeline distance
      const trueDist = ((vy + renderLength / 2) / renderLength) * sLength + startDist;
      
      // Calculate orientation (theta in degrees)
      let theta = Math.atan2(vx, vz);
      if (theta < 0) theta += 2 * Math.PI;
      const orientDeg = theta * (180 / Math.PI);
      
      // --- GIRTH WELD: Paint & Bulge ---
      // Find nearest girth weld distance
      let minGwDist = Infinity;
      for (const gwDist of gwList) {
        const d = Math.abs(trueDist - gwDist);
        if (d < minGwDist) minGwDist = d;
      }
      
      // Convert weld half-width from real meters to the vy coordinate space
      const weldHalfWidthVy = (weldHalfWidth / sLength) * renderLength;
      const minGwDistVy = (minGwDist / sLength) * renderLength;
      
      let isInWeld = false;
      if (minGwDistVy < weldHalfWidthVy) {
        isInWeld = true;
        // Smooth cosine profile for realistic weld cap shape
        const t = minGwDistVy / weldHalfWidthVy; // 0 at center, 1 at edge
        const bulge = (Math.cos(t * Math.PI) + 1) * 0.5 * weldBulgeHeight;
        
        // Push vertex outward radially
        const currentR = Math.sqrt(vx * vx + vz * vz);
        if (currentR > 0) {
          const newR = currentR + bulge;
          vx = vx * (newR / currentR);
          vz = vz * (newR / currentR);
          pos.setX(i, vx);
          pos.setZ(i, vz);
        }
        
        // Paint weld bead color - darker steel/silver tone
        // Slight gradient: center is brighter (fresh weld), edge blends into pipe
        const brightness = 0.35 + t * 0.15;
        color.setRGB(brightness, brightness, brightness + 0.05);
      }
      
      // --- DEFECT HEATMAP (only if not already painted as weld) ---
      if (!isInWeld) {
        let maxDepth = 0;
        spoolData.forEach(d => {
          const checkDefect = (dist: number, orient: number, len: number, wid: number, depth: number) => {
            const sLen = Math.max(0.4, len * 0.03); 
            const sWidAngle = Math.max(15, wid * 1.5); 
            const inDist = Math.abs(trueDist - dist) <= (sLen / 2);
            let angleDiff = Math.abs(orientDeg - orient);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            const inOrient = angleDiff <= (sWidAngle / 2);
            if (inDist && inOrient) maxDepth = Math.max(maxDepth, depth);
          };
          if (d.dist1 !== null) checkDefect(d.dist1, d.orient1, d.len1, d.wid1, d?.depth1);
          if (d.dist2 !== null) checkDefect(d.dist2, d.orient2, d.len2, d.wid2, d?.depth2);
        });
        
        if (maxDepth > 0) {
          if (maxDepth > 1.5) color.set('#991b1b'); 
          else if (maxDepth > 1.0) color.set('#ef4444'); 
          else if (maxDepth > 0.5) color.set('#f97316'); 
          else color.set('#eab308'); 
        }
      }
      
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    
    pos.needsUpdate = true;
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [renderLength, sLength, startDist, spoolData, gwList]);

  const padding = 2.0;
  const clockRadius = 2.4;
  const capY = -(renderLength / 2) - padding;

  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      {/* Pipe Surface with integrated weld bulges & defect heatmap */}
      <mesh geometry={geom}>
        <meshStandardMaterial vertexColors={true} roughness={0.55} metalness={0.35} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Subtle wireframe overlay */}
      <mesh geometry={geom} scale={[1.001, 1, 1.001]}>
        <meshBasicMaterial color="#0f172a" wireframe transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* Clock Position Labels at pipe end */}
      <Text position={[0, capY, clockRadius]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">12:00</Text>
      <Text position={[clockRadius, capY, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">3:00</Text>
      <Text position={[0, capY, -clockRadius]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">6:00</Text>
      <Text position={[-clockRadius, capY, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">9:00</Text>
    </group>
  );
};

const DefectOverlayMeshes = ({ spoolData, renderLength, sLength, startDist, onSelect }: any) => {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      {spoolData.map((d: any, i: number) => {
        const renderMesh = (dist: number | null, orient: number, len: number, wid: number, depth: number, id: string) => {
          if (dist === null) return null;
          const vy = ((dist - startDist) / sLength) * renderLength - renderLength / 2;
          const angle = orient * (Math.PI / 180);
          const vx = Math.cos(angle) * 2.05;
          const vz = Math.sin(angle) * 2.05;
          const boxLen = Math.max(0.6, len * 0.05); 
          const boxWid = Math.max(0.6, wid * 0.05);
          return (
            <mesh 
              key={`def-3d-${i}-${id}-${dist}`} 
              position={[vx, vy, vz]} 
              rotation={[0, -angle, 0]} 
              onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
              onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'default'; }}
              onClick={(e) => { e.stopPropagation(); onSelect(id, d, e); }}
            >
              <boxGeometry args={[boxWid, boxLen, 1.0]} />
              <meshBasicMaterial transparent opacity={0.0} />
            </mesh>
          );
        };
        return (
          <React.Fragment key={`frag-${i}`}>
            {renderMesh(d.dist1, d.orient1, d.len1, d.wid1, d?.depth1, d?.id1)}
            {renderMesh(d.dist2, d.orient2, d.len2, d.wid2, d?.depth2, d?.id2)}
          </React.Fragment>
        );
      })}
    </group>
  );
};

export default function DefectVisualizer({ data, selectedRowIdx, onSelectRowIdx }: DefectVisualizerProps) {
  const [zoom, setZoom] = useState(1);
  const [rangeStartGw, setRangeStartGw] = useState<number | null>(null);
  const [rangeEndGw, setRangeEndGw] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalViewMode, setModalViewMode] = useState<'2D' | '3D'>('3D');
  const [hoveredDefect, setHoveredDefect] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [runOldName, setRunOldName] = useState('RUN OLD (REFERENCE)');
  const [runNewName, setRunNewName] = useState('RUN NEW (CURRENT)');
  const [oldRawFeatures, setOldRawFeatures] = useState<any[]>([]);
  const [newRawFeatures, setNewRawFeatures] = useState<any[]>([]);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const sessionId = new URLSearchParams(window.location.search).get('sessionId') || localStorage.getItem('synapse_last_session_id');
        if (sessionId) {
          const data = await apiFetch<{ config?: unknown }>(`/api/wizard/session/${encodeURIComponent(sessionId)}`);
          if (data.config) {
             const config = typeof data.config === 'string' ? JSON.parse(data.config) : data.config;
             const oldY = config?.summaryData?.oldRun?.year || config?.oldRun?.year;
             const newY = config?.summaryData?.newRun?.year || config?.newRun?.year;
             if (oldY) setRunOldName(`${oldY} (Reference)`);
             if (newY) setRunNewName(`${newY} (Current)`);
             
             if (config?.summaryData?.oldRun?.rawFeatures) {
               setOldRawFeatures(config.summaryData.oldRun.rawFeatures);
             }
             if (config?.summaryData?.newRun?.rawFeatures) {
               setNewRawFeatures(config.summaryData.newRun.rawFeatures);
             }
          }
        }
      } catch {}
    };
    fetchSession();
  }, []);

  // Parse data into usable array of objects
  const parsedData = useMemo(() => {
    return data.map((item, idx) => {
      if (!item) return null;
      
      const r1Dist = parseFloat(item['Log Dist OLD (m)']);
      const r2Dist = parseFloat(item['Log Dist NEW (m)']);
      const isMatched = !isNaN(r1Dist) && !isNaN(r2Dist);
      
      const r1Depth = parseFloat(item['Depth OLD (%WT)']) || 0;
      const r2Depth = parseFloat(item['Depth NEW (%WT)']) || 0;
      const isExt1 = r1Depth > 1.0;
      const isExt2 = r2Depth > 1.0;
      
      const isWeld1 = String(item['Feature Type OLD'] || '').toLowerCase().includes('weld');
      const isWeld2 = String(item['Feature Type NEW'] || '').toLowerCase().includes('weld');
      const isValve1 = String(item['Feature Type OLD'] || '').toLowerCase().includes('valve');
      const isValve2 = String(item['Feature Type NEW'] || '').toLowerCase().includes('valve');
      const isTee1 = String(item['Feature Type OLD'] || '').toLowerCase().includes('tee');
      const isTee2 = String(item['Feature Type NEW'] || '').toLowerCase().includes('tee');

      return {
        id1: (item['Identif. OLD'] && item['Identif. OLD'] !== '-') ? String(item['Identif. OLD']) : (item['Log Dist OLD (m)'] !== undefined && item['Log Dist OLD (m)'] !== '') ? `DIST:${item['Log Dist OLD (m)']}` : null,
        dist1: isNaN(r1Dist) ? null : r1Dist,
        len1: parseFloat(item['Length OLD (mm)']) || 10,
        wid1: parseFloat(item['Width OLD (mm)']) || 10,
        orient1: (() => { const v = item["O'Clock OLD"]; if (v == null || v === '-') return 0; const s = String(v); if (s.includes(':')) { const [h, m] = s.split(':').map(Number); return (h % 12) + (m || 0) / 60; } const n = parseFloat(s); if (isNaN(n)) return 0; return (n > 0 && n < 1) ? (n * 24) % 12 : n % 12; })(),
        depth1: r1Depth,
        isExt1,
        isWeld1,
        isValve1,
        isTee1,
        
        id2: (item['Identif. NEW'] && item['Identif. NEW'] !== '-') ? String(item['Identif. NEW']) : (item['Log Dist NEW (m)'] !== undefined && item['Log Dist NEW (m)'] !== '') ? `DIST:${item['Log Dist NEW (m)']}` : null,
        dist2: isNaN(r2Dist) ? null : r2Dist,
        len2: parseFloat(item['Length NEW (mm)']) || 10,
        wid2: parseFloat(item['Width NEW (mm)']) || 10,
        orient2: (() => { const v = item["O'Clock NEW"]; if (v == null || v === '-') return 0; const s = String(v); if (s.includes(':')) { const [h, m] = s.split(':').map(Number); return (h % 12) + (m || 0) / 60; } const n = parseFloat(s); if (isNaN(n)) return 0; return (n > 0 && n < 1) ? (n * 24) % 12 : n % 12; })(),
        depth2: r2Depth,
        isExt2,
        isWeld2,
        isValve2,
        isTee2,

        isMatched,
        rawItem: item,
        dataIdx: idx
      };
    }).filter(Boolean);
  }, [data]);

  // Derived boundaries
  const minDistance = Math.min(...parsedData.flatMap(d => [d?.dist1, d?.dist2]).filter(d => d !== null && d !== undefined) as number[]);
  const maxDistance = Math.max(...parsedData.flatMap(d => [d?.dist1, d?.dist2]).filter(d => d !== null && d !== undefined) as number[]);
  const totalLength = Math.max(10, maxDistance - minDistance + 20);
  const startDist = Math.max(0, minDistance - 10);

  const baseWidth = Math.max(1200, totalLength * 5);
  const svgWidth = baseWidth * zoom;
  
  const mToX = (meters: number) => {
    return ((meters - startDist) / totalLength) * svgWidth;
  };

  // Extract actual GWs from data
  const gwList = useMemo(() => {
    const list = parsedData
      .filter((d: any) => d !== null)
      .filter(d => (d.isWeld1 && d.dist1 !== null) || (d.isWeld2 && d.dist2 !== null && d.dist1 !== null))
      .map(d => d.dist1 as number)
      .sort((a, b) => a - b);
    
    // Add start and end boundaries if there are no welds (fallback)
    if (list.length === 0) {
       for(let d = startDist; d <= startDist + totalLength; d += 12) list.push(d);
    }
    return Array.from(new Set(list));
  }, [parsedData, startDist, totalLength]);

  // Determine actual selected range
  let selectedRange: { startDist: number, endDist: number, length: number, startIdx: number, endIdx: number } | null = null;
  if (rangeStartGw !== null && rangeEndGw !== null) {
    const startIdx = Math.min(rangeStartGw, rangeEndGw);
    const endIdx = Math.max(rangeStartGw, rangeEndGw);
    if (startIdx !== endIdx && gwList[startIdx] !== undefined && gwList[endIdx] !== undefined) {
      const sDist = gwList[startIdx];
      const eDist = gwList[endIdx];
      selectedRange = { startDist: sDist, endDist: eDist, length: eDist - sDist, startIdx, endIdx };
    }
  }

  const handleGwClick = (index: number) => {
    if (rangeStartGw === null || (rangeStartGw !== null && rangeEndGw !== null)) {
      setRangeStartGw(index);
      setRangeEndGw(null);
    } else {
      setRangeEndGw(index);
    }
  };

  const handleSpoolClick = (index: number) => {
    setRangeStartGw(index);
    setRangeEndGw(index + 1);
  };
  
  // Render functions
  const render1DTimeline = () => {
    return (
      <div className="border border-gray-100 rounded-xl overflow-x-auto bg-[#fafbfc] shadow-inner">
        <div style={{ width: svgWidth, minWidth: '100%', height: '280px' }} className="relative transition-all duration-300">
          <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* --- RUN OLD (REFERENCE) --- */}
            <text x="20" y="40" className="text-xs font-extrabold fill-gray-400 tracking-wider uppercase">{runOldName}</text>
            <line x1="0" y1="80" x2="100%" y2="80" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
            
            {/* Draw Highlighted Range Background First */}
            {selectedRange && (
              <rect 
                x={mToX(selectedRange.startDist)} y="65" 
                width={mToX(selectedRange.endDist) - mToX(selectedRange.startDist)} height="30" 
                fill="rgba(253, 224, 71, 0.3)" 
              />
            )}
            {selectedRange && (
              <line 
                x1={mToX(selectedRange.startDist)} y1="80" 
                x2={mToX(selectedRange.endDist)} y2="80" 
                stroke="#eab308" strokeWidth="6" strokeLinecap="round" 
              />
            )}
            
            {/* Draw GW Ticks & Spool Hitboxes */}
            {gwList.slice(0, -1).map((dist1, i) => {
               const dist2 = gwList[i + 1];
               const x1 = mToX(dist1);
               const x2 = mToX(dist2);
               
               const isGwSelected = (rangeStartGw === i && rangeEndGw === null) || 
                                    (selectedRange && i >= selectedRange.startIdx && i < selectedRange.endIdx);
               const color = isGwSelected ? "#eab308" : "#10b981";
               
               return (
                 <g key={`gw-1-${i}`}>
                   {/* Spool Hitbox */}
                   <rect 
                     x={x1} y="65" width={Math.max(1, x2 - x1)} height="30" 
                     fill="transparent" 
                     className="cursor-pointer hover:fill-yellow-100/30 transition-colors"
                     onClick={() => handleSpoolClick(i)}
                   />

                   {/* Alignment guide */}
                   <line x1={x1} y1="80" x2={x1} y2="210" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                   
                   {/* GW Marker - Make it clickable */}
                   <rect 
                     x={x1 - 4} y="55" width="8" height="50" rx="4" fill={color} 
                     className="cursor-pointer hover:brightness-110"
                     onClick={() => handleGwClick(i)}
                   />
                   <text x={x1} y="115" fontSize="10" fontWeight="bold" fill={color} textAnchor="middle">{dist1.toFixed(2)}m</text>
                 </g>
               );
            })}
            {/* Draw the very last GW marker */}
            {gwList.length > 0 && (
              <g>
                <rect 
                  x={mToX(gwList[gwList.length - 1]) - 4} y="55" width="8" height="50" rx="4" fill="#10b981" 
                  className="cursor-pointer hover:brightness-110"
                  onClick={() => handleGwClick(gwList.length - 1)}
                />
                <text x={mToX(gwList[gwList.length - 1])} y="115" fontSize="10" fontWeight="bold" fill="#10b981" textAnchor="middle">{gwList[gwList.length - 1].toFixed(2)}m</text>
              </g>
            )}
            
            {/* Raw Features: Valves & Tees (Run 1) */}
            {oldRawFeatures.map((feat, i) => {
              const typeStr = String(feat['Feature Type'] || feat['type'] || feat['feature_identification'] || '').toLowerCase();
              if (typeStr.includes('valve') || typeStr.includes('tee')) {
                const dist = parseFloat(feat['Log Dist (m)'] || feat['Log Distance (m)'] || feat['Distance (m)']);
                if (!isNaN(dist) && dist >= startDist && dist <= startDist + totalLength) {
                  const x = mToX(dist);
                  const label = typeStr.includes('valve') ? 'VALVE' : 'TEE';
                  return (
                    <g key={`raw-landmark1-${i}`} className="z-20">
                      <circle cx={x} cy="65" r="4" fill="#8b5cf6" stroke="#ffffff" strokeWidth="1" />
                      <text x={x} y="55" fontSize="9" fontWeight="black" fill="#8b5cf6" textAnchor="middle">{label}</text>
                    </g>
                  );
                }
              }
              return null;
            })}

            {/* Run 1 Anomalies & Landmarks */}
            {parsedData.map((d, i) => {
              if (d?.dist1 === null || d?.dist1 === undefined) return null;
              const x = mToX(d.dist1);
              const searchStr = selectedRowIdx;
              const isSel = searchStr !== null && searchStr !== undefined && d.dataIdx === searchStr;

              return (
                <g 
                  key={`anom1-${i}`} 
                  className={`cursor-pointer ${isSel ? 'z-20' : 'z-10'}`} 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setHoveredDefect(d);
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <circle cx={x} cy="80" r={isSel ? "10" : "6"} fill={d.isMatched ? "#f59e0b" : "#ef4444"} stroke={isSel ? "#000000" : "#ffffff"} strokeWidth={isSel ? "3" : "2"} />
                  <text x={x} y={isSel ? "40" : "55"} fontSize={isSel ? "11" : "9"} fontWeight="bold" fill={d.isMatched ? "#d97706" : "#ef4444"} textAnchor="middle">A-{d?.id1}</text>
                </g>
              );
            })}

            {/* --- RUN NEW (CURRENT) --- */}
            <text x="20" y="170" className="text-xs font-extrabold fill-gray-400 tracking-wider uppercase">{runNewName}</text>
            <line x1="0" y1="210" x2="100%" y2="210" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
            
            {/* Draw Run 2 GW Ticks */}
            {Array.from({ length: Math.ceil(totalLength / 12) + 1 }).map((_, i) => {
               const dist = startDist + (i * 12) + (i * 0.05);
               const x = mToX(dist);
               const isSelected = (rangeStartGw === i && rangeEndGw === null) || 
                                  (selectedRange && i >= selectedRange.startIdx && i <= selectedRange.endIdx);
               return (
                 <g key={`gw-2-${i}`}>
                   <rect x={x - 3} y="190" width="6" height="40" rx="3" fill={isSelected ? "#eab308" : "#3b82f6"} />
                   <text x={x} y="245" fontSize="10" fontWeight="bold" fill={isSelected ? "#eab308" : "#2563eb"} textAnchor="middle">{dist.toFixed(2)}m</text>
                 </g>
               );
            })}

            {/* Raw Features: Valves & Tees (Run 2) */}
            {newRawFeatures.map((feat, i) => {
              const typeStr = String(feat['Feature Type'] || feat['type'] || feat['feature_identification'] || '').toLowerCase();
              if (typeStr.includes('valve') || typeStr.includes('tee')) {
                const dist = parseFloat(feat['Log Dist (m)'] || feat['Log Distance (m)'] || feat['Distance (m)']);
                if (!isNaN(dist) && dist >= startDist && dist <= startDist + totalLength) {
                  const x2 = mToX(dist);
                  const label = typeStr.includes('valve') ? 'VALVE' : 'TEE';
                  return (
                    <g key={`raw-landmark2-${i}`} className="z-20">
                      <circle cx={x2} cy="195" r="4" fill="#8b5cf6" stroke="#ffffff" strokeWidth="1" />
                      <text x={x2} y="185" fontSize="9" fontWeight="black" fill="#8b5cf6" textAnchor="middle">{label}</text>
                    </g>
                  );
                }
              }
              return null;
            })}

            {/* Run 2 Anomalies & Landmarks */}
            {parsedData.map((d, i) => {
              if (d?.dist2 === null || d?.dist2 === undefined) return null;
              const x2 = mToX(d.dist2);
              const isSel = selectedRowIdx !== null && selectedRowIdx !== undefined && d.dataIdx === selectedRowIdx;

              return (
                <g 
                  key={`anom2-${i}`} 
                  className={`cursor-pointer ${isSel ? 'z-20' : 'z-10'}`} 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setHoveredDefect(d);
                    setTooltipPos({ x: e.clientX, y: e.clientY });
                  }}
                >
                  {/* Match line */}
                  {d.isMatched && d.dist1 !== null && d.dist1 !== undefined && (
                    <line x1={mToX(d.dist1)} y1="80" x2={x2} y2="210" stroke={isSel ? "#ef4444" : "#fca5a5"} strokeWidth={isSel ? "3" : "2"} strokeDasharray="4 4" />
                  )}
                  <circle cx={x2} cy="210" r={isSel ? "10" : "6"} fill={d.isMatched ? "#f59e0b" : "#ef4444"} stroke={isSel ? "#000000" : "#ffffff"} strokeWidth={isSel ? "3" : "2"} />
                  <text x={x2} y={isSel ? "250" : "235"} fontSize={isSel ? "11" : "9"} fontWeight="bold" fill={d.isMatched ? "#d97706" : "#ef4444"} textAnchor="middle">A-{d?.id2}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  const renderModalContent = () => {
    if (!selectedRange) return null;
    
    // Filter data to only those inside the spool (using Run 1 distance as reference)
    const spoolData = parsedData.filter(d => {
      if (d === null) return false;
      const dist = d.dist1 !== null ? d.dist1 : d.dist2; // Fallback to dist2 if unmatched new
      if (dist === null) return false;
      return dist >= selectedRange.startDist && dist <= selectedRange.endDist;
    });

    const sLength = selectedRange.length;
    // For 2D SVG rendering inside modal (fixed width)
    const modalSvgWidth = 800;
    const sToX = (dist: number) => {
      return ((dist - selectedRange.startDist) / sLength) * modalSvgWidth;
    };

    if (modalViewMode === '2D') {
      const pipeHeight = 240; 
      const oToY = (orient: number) => (orient / 360) * pipeHeight;

      return (
        <div className="w-full flex justify-center">
          <div style={{ width: modalSvgWidth, height: pipeHeight + 60 }} className="relative bg-white border border-gray-200 rounded-xl shadow-inner">
            <svg width="100%" height="100%">
              {[0, 90, 180, 270, 360].map((deg) => {
                const y = oToY(deg) + 30;
                let label = '12:00';
                if (deg === 90) label = '3:00';
                if (deg === 180) label = '6:00';
                if (deg === 270) label = '9:00';
                return (
                  <g key={`clock-${deg}`}>
                    <line x1="0" y1={y} x2="100%" y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />
                    <text x="10" y={y - 5} fontSize="10" fill="#94a3b8" fontWeight="bold">{deg}° ({label})</text>
                  </g>
                );
              })}

              {spoolData.map((d, i) => {
                const scaleDim = (val: number) => Math.max(10, val * 0.8); 

                if (d.isMatched && d.dist1 !== null && d.dist2 !== null) {
                  const cx1 = sToX(d.dist1);
                  const cy1 = oToY(d.orient1) + 30;
                  const w1 = scaleDim(d.len1);
                  const h1 = scaleDim(d.wid1);

                  const cx2 = sToX(d.dist2);
                  const cy2 = oToY(d.orient2) + 30;
                  const w2 = scaleDim(d.len2);
                  const h2 = scaleDim(d.wid2);

                  return (
                    <g 
                      key={`2d-match-${i}`}
                      className="cursor-pointer"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setHoveredDefect(d);
                        setTooltipPos({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      <line x1={cx1} y1={cy1} x2={cx2} y2={cy2} stroke="#fca5a5" strokeWidth="1" strokeDasharray="2 2" />
                      <ellipse 
                        cx={cx1} cy={cy1} rx={w1/2} ry={h1/2}
                        fill={d.isExt1 ? "rgba(148, 163, 184, 0.4)" : "transparent"} 
                        stroke="#94a3b8" strokeWidth={d.isExt1 ? "1" : "2"} strokeDasharray={d.isExt1 ? "0" : "2"}
                      />
                      <ellipse 
                        cx={cx2} cy={cy2} rx={w2/2} ry={h2/2}
                        fill={d.isExt2 ? "rgba(239, 68, 68, 0.6)" : "transparent"} 
                        stroke="#ef4444" strokeWidth={d.isExt2 ? "1" : "2"} strokeDasharray={d.isExt2 ? "0" : "2"}
                      />
                      {(d.len2 > d.len1 || d.wid2 > d.wid1) && (
                         <text x={cx2} y={cy2 - h2/2 - 5} fontSize="10" fill="#b91c1c" fontWeight="bold" textAnchor="middle">Growth!</text>
                      )}
                    </g>
                  );
                } else {
                  const isRun1 = d.dist1 !== null;
                  const cx = isRun1 ? sToX(d.dist1 as number) : sToX(d.dist2 as number);
                  const cy = isRun1 ? oToY(d.orient1) + 30 : oToY(d.orient2) + 30;
                  const w = scaleDim(isRun1 ? d.len1 : d.len2);
                  const h = scaleDim(isRun1 ? d.wid1 : d.wid2);
                  const isExt = isRun1 ? d.isExt1 : d.isExt2;
                  const color = isRun1 ? "#3b82f6" : "#f59e0b";

                  return (
                    <g 
                      key={`2d-unmatch-${i}`}
                      className="cursor-pointer"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setHoveredDefect(d);
                        setTooltipPos({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      <ellipse 
                        cx={cx} cy={cy} rx={w/2} ry={h/2}
                        fill={isExt ? color : "transparent"} fillOpacity={0.6}
                        stroke={color} strokeWidth={isExt ? "1" : "2"} strokeDasharray={isExt ? "0" : "2"}
                      />
                    </g>
                  );
                }
              })}
            </svg>
          </div>
        </div>
      );
    }

    if (modalViewMode === '3D') {
      // Limit 3D pipe length rendering so we don't build a 500m pipe if they selected a huge range
      const renderLength = Math.min(sLength, 200); 

      return (
        <div className="w-full h-[400px] bg-[#1e293b] rounded-xl overflow-hidden relative shadow-inner">
           <div className="absolute top-4 left-4 z-10 text-white/70 text-xs">Left Click: Rotate | Right Click: Pan | Scroll: Zoom</div>
           <Canvas camera={{ position: [0, 0, Math.min(20, renderLength / 2)], fov: 45 }}>
             <ambientLight intensity={0.7} />
             <directionalLight position={[10, 20, 10]} intensity={1.5} />
             <OrbitControls enableDamping dampingFactor={0.05} />
             
             <FEAPipeMesh 
               renderLength={renderLength} 
               sLength={sLength} 
               startDist={selectedRange.startDist} 
               spoolData={spoolData} 
               gwList={gwList}
             />
             <DefectOverlayMeshes 
               spoolData={spoolData} 
               renderLength={renderLength} 
               sLength={sLength} 
               startDist={selectedRange.startDist} 
               onHover={() => {}}
               onSelect={(id: string, d: any, e: any) => {
                 setHoveredDefect(d);
                 if (e) setTooltipPos({ x: e.clientX, y: e.clientY });
               }}
             />
           </Canvas>
        </div>
      );
    }
    
    return null;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-6 hover:shadow-md transition-shadow relative">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div className="flex items-center gap-6">
          <div>
            <h3 className="text-xl font-extrabold text-gray-800 bg-gradient-to-r from-gray-900 to-gray-500 bg-clip-text text-transparent">
              Alignment Timeline Viewer
            </h3>
            <p className="text-sm text-gray-500 font-medium mt-1">
              {(totalLength / 1000).toFixed(1)}+ km Interactive Pipeline Alignment Map
            </p>
          </div>
          
          {/* Dynamic Selection Actions */}
          {selectedRange && (
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-300">
              <div className="px-4 py-2 bg-yellow-50 text-yellow-700 border border-yellow-200 font-bold rounded-full text-sm">
                Selection Length: {selectedRange.length.toFixed(2)}m
              </div>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-black rounded-full shadow-sm hover:shadow-md transition-all active:scale-95"
              >
                <FiBox size={18} /> Look 3D Pipeline
              </button>
            </div>
          )}
        </div>
        
        {/* Main Zoom */}
        <div className="flex items-center gap-3 bg-gray-50 px-4 py-2 rounded-xl border border-gray-100 shadow-inner self-end">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Zoom:</span>
          <input 
            type="range" 
            min="1" max="25" step="0.1" 
            value={zoom} 
            onChange={e => setZoom(parseFloat(e.target.value))}
            className="w-32 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>
      </div>

      {/* Main 1D Timeline */}
      <div className="mt-2">
        {render1DTimeline()}
      </div>

      {/* Detail Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-gray-900/40 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 bg-gray-50">
              <div>
                <h2 className="text-xl font-black text-gray-800">Spool Detail View</h2>
                <p className="text-sm text-gray-500 font-medium">Distance: {selectedRange?.startDist.toFixed(2)}m to {selectedRange?.endDist.toFixed(2)}m</p>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="flex bg-gray-200 p-1 rounded-xl shadow-inner border border-gray-300">
                  <button
                    onClick={() => setModalViewMode('2D')}
                    className={`px-6 py-1.5 rounded-lg text-sm font-bold transition-all ${
                      modalViewMode === '2D' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    2D Unrolled
                  </button>
                  <button
                    onClick={() => setModalViewMode('3D')}
                    className={`px-6 py-1.5 rounded-lg text-sm font-bold transition-all ${
                      modalViewMode === '3D' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    3D Pipe
                  </button>
                </div>
                
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <FiX size={24} />
                </button>
              </div>
            </div>
            
            {/* Modal Content */}
            <div className="p-8 bg-gray-50 flex flex-col items-center justify-center min-h-[500px]">
              {renderModalContent()}
              
              {/* Legend for 2D Mode inside Modal */}
              {modalViewMode === '2D' && (
                 <div className="flex gap-6 mt-6 justify-center w-full max-w-3xl border-t border-gray-200 pt-4">
                   <div className="flex items-center gap-2">
                     <div className="w-4 h-4 bg-gray-400 opacity-40 border border-gray-500"></div>
                     <span className="text-xs font-medium text-gray-600">Run 1 (Old) Size</span>
                   </div>
                   <div className="flex items-center gap-2">
                     <div className="w-4 h-4 bg-red-500 opacity-60 border border-red-600"></div>
                     <span className="text-xs font-medium text-gray-600">Run 2 (New) Growth</span>
                   </div>
                   <div className="flex items-center gap-2">
                     <div className="w-4 h-4 border-2 border-dashed border-gray-500"></div>
                     <span className="text-xs font-medium text-gray-600">Internal Defect</span>
                   </div>
                   <div className="flex items-center gap-2">
                     <div className="w-4 h-4 border-2 border-solid border-gray-500"></div>
                     <span className="text-xs font-medium text-gray-600">External Defect</span>
                   </div>
                 </div>
              )}
            </div>
          </div>
        </div>
      )}


      {hoveredDefect && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setHoveredDefect(null)} />
          <div 
            className="fixed z-[100] bg-white border border-gray-200 shadow-xl rounded-lg p-3 text-xs w-64 pointer-events-auto"
            style={{ left: tooltipPos.x + 15, top: tooltipPos.y + 15 }}
          >
            <div className="font-bold border-b pb-1 mb-2 text-gray-800 flex justify-between items-center gap-2">
              <span>ID: {hoveredDefect.id1 || hoveredDefect.id2}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] ${hoveredDefect.isMatched ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {hoveredDefect.isMatched ? 'Matched' : 'Unmatched'}
              </span>
            </div>
            <div className="flex flex-col gap-1 mb-3">
              <div className="flex justify-between border-b border-gray-50 pb-1">
                <span className="text-gray-500 font-medium">Dist U/S GW:</span>
                <span className="font-bold text-gray-800">{hoveredDefect.rawItem['Dist GW OLD (m)'] || hoveredDefect.rawItem['Dist GW NEW (m)'] || '-'} m</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-1">
                <span className="text-gray-500 font-medium">Clock:</span>
                <span className="font-bold text-gray-800">{hoveredDefect.rawItem["O'Clock OLD"] || hoveredDefect.rawItem["O'Clock NEW"] || '-'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-1">
                <span className="text-gray-500 font-medium">Ext/Int:</span>
                <span className="font-bold text-gray-800">{hoveredDefect.rawItem['Int/Ext OLD'] || hoveredDefect.rawItem['Int/Ext NEW'] || hoveredDefect.rawItem['Feature Type OLD'] || (hoveredDefect.isExt1 ? 'External' : 'Internal')}</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-1">
                <span className="text-gray-500 font-medium">Depth:</span>
                <span className="font-bold text-gray-800">{hoveredDefect.rawItem['Depth OLD (%WT)'] || hoveredDefect.rawItem['Depth NEW (%WT)'] || '-'} %WT</span>
              </div>
              <div className="flex justify-between border-b border-gray-50 pb-1">
                <span className="text-gray-500 font-medium">Length:</span>
                <span className="font-bold text-gray-800">{hoveredDefect.rawItem['Length OLD (mm)'] || hoveredDefect.rawItem['Length NEW (mm)'] || '-'} mm</span>
              </div>
              <div className="flex justify-between pb-1">
                <span className="text-gray-500 font-medium">Width:</span>
                <span className="font-bold text-gray-800">{hoveredDefect.rawItem['Width OLD (mm)'] || hoveredDefect.rawItem['Width NEW (mm)'] || '-'} mm</span>
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onSelectRowIdx?.(hoveredDefect.dataIdx);
                setHoveredDefect(null);
                if (isModalOpen) setIsModalOpen(false);
              }}
              className="w-full bg-blue-500 text-white rounded py-2 hover:bg-blue-600 transition-colors font-bold cursor-pointer shadow-sm"
            >
              Cari & Sorot Data di Tabel
            </button>
          </div>
        </>
      )}

    </div>
  );
}
