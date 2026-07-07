import React, { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { FiBox, FiX } from 'react-icons/fi';

interface DefectVisualizerProps {
  data: any[];
}

export default function DefectVisualizer({ data }: DefectVisualizerProps) {
  const [zoom, setZoom] = useState(1);
  const [rangeStartGw, setRangeStartGw] = useState<number | null>(null);
  const [rangeEndGw, setRangeEndGw] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalViewMode, setModalViewMode] = useState<'2D' | '3D'>('3D');

  // Parse data into usable array of objects
  const parsedData = useMemo(() => {
    return data.map(item => {
      if (!item) return null;
      
      const r1Dist = parseFloat(item['DATA LAMA 2020 (Vendor Lama)  >']);
      const r2Dist = parseFloat(item['<  DATA BARU 2025 (Vendor Baru)']);
      const isMatched = !isNaN(r1Dist) && !isNaN(r2Dist);
      
      const r1Depth = parseFloat(item['Unnamed: 37']) || 0;
      const r2Depth = parseFloat(item['Unnamed: 10']) || 0;
      const isExt1 = r1Depth > 1.0;
      const isExt2 = r2Depth > 1.0;

      return {
        id1: item['Unnamed: 29'] || '',
        dist1: isNaN(r1Dist) ? null : r1Dist,
        len1: parseFloat(item['Unnamed: 35']) || 10,
        wid1: parseFloat(item['Unnamed: 32']) || 10,
        orient1: parseFloat(item['Unnamed: 34']) || 0,
        depth1: r1Depth,
        isExt1,
        
        id2: item['Unnamed: 2'] || '',
        dist2: isNaN(r2Dist) ? null : r2Dist,
        len2: parseFloat(item['Unnamed: 8']) || 10,
        wid2: parseFloat(item['Unnamed: 5']) || 10,
        orient2: parseFloat(item['Unnamed: 7']) || 0,
        depth2: r2Depth,
        isExt2,

        isMatched
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

  const numGws = Math.ceil(totalLength / 12);
  const gwDistance = 12;

  // Determine actual selected range
  let selectedRange: { startDist: number, endDist: number, length: number, startIdx: number, endIdx: number } | null = null;
  if (rangeStartGw !== null && rangeEndGw !== null) {
    const startIdx = Math.min(rangeStartGw, rangeEndGw);
    const endIdx = Math.max(rangeStartGw, rangeEndGw);
    if (startIdx !== endIdx) {
      const sDist = startDist + startIdx * gwDistance;
      const eDist = startDist + endIdx * gwDistance;
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
            <text x="20" y="40" className="text-xs font-extrabold fill-gray-400 tracking-wider">RUN OLD (REFERENCE)</text>
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
            {Array.from({ length: numGws }).map((_, i) => {
               const dist1 = startDist + i * gwDistance;
               const dist2 = startDist + (i + 1) * gwDistance;
               const x1 = mToX(dist1);
               const x2 = mToX(dist2);
               
               const isGwSelected = (rangeStartGw === i && rangeEndGw === null) || 
                                    (selectedRange && i >= selectedRange.startIdx && i <= selectedRange.endIdx);
               const color = isGwSelected ? "#eab308" : "#10b981";
               
               return (
                 <g key={`gw-1-${i}`}>
                   {/* Spool Hitbox */}
                   <rect 
                     x={x1} y="65" width={x2 - x1} height="30" 
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
            <g>
              {(() => {
                const i = numGws;
                const dist1 = startDist + i * gwDistance;
                const x1 = mToX(dist1);
                const isGwSelected = (rangeStartGw === i && rangeEndGw === null) || 
                                     (selectedRange && i >= selectedRange.startIdx && i <= selectedRange.endIdx);
                const color = isGwSelected ? "#eab308" : "#10b981";
                return (
                  <>
                    <rect 
                      x={x1 - 4} y="55" width="8" height="50" rx="4" fill={color} 
                      className="cursor-pointer hover:brightness-110"
                      onClick={() => handleGwClick(i)}
                    />
                    <text x={x1} y="115" fontSize="10" fontWeight="bold" fill={color} textAnchor="middle">{dist1.toFixed(2)}m</text>
                  </>
                );
              })()}
            </g>

            {/* Run 1 Anomalies */}
            {parsedData.map((d, i) => {
              if (d?.dist1 === null || d?.dist1 === undefined) return null;
              const x = mToX(d.dist1);
              return (
                <g key={`anom1-${i}`} className="cursor-pointer pointer-events-none">
                  <circle cx={x} cy="80" r="6" fill={d.isMatched ? "#f59e0b" : "#ef4444"} stroke="#ffffff" strokeWidth="2" />
                  <text x={x} y="55" fontSize="9" fontWeight="bold" fill={d.isMatched ? "#d97706" : "#ef4444"} textAnchor="middle">A-{d.id1}</text>
                </g>
              );
            })}

            {/* --- RUN NEW (CURRENT) --- */}
            <text x="20" y="170" className="text-xs font-extrabold fill-gray-400 tracking-wider">RUN NEW (CURRENT)</text>
            <line x1="0" y1="210" x2="100%" y2="210" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
            
            {/* Draw Run 2 GW Ticks */}
            {Array.from({ length: numGws + 1 }).map((_, i) => {
               const dist = startDist + (i * gwDistance) + (i * 0.05);
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

            {/* Run 2 Anomalies */}
            {parsedData.map((d, i) => {
              if (d?.dist2 === null || d?.dist2 === undefined) return null;
              const x2 = mToX(d.dist2);
              
              return (
                <g key={`anom2-${i}`} className="cursor-pointer pointer-events-none">
                  {/* Match line */}
                  {d.isMatched && d.dist1 !== null && d.dist1 !== undefined && (
                    <line x1={mToX(d.dist1)} y1="80" x2={x2} y2="210" stroke="#fca5a5" strokeWidth="2" strokeDasharray="4 4" />
                  )}
                  <circle cx={x2} cy="210" r="6" fill={d.isMatched ? "#f59e0b" : "#ef4444"} stroke="#ffffff" strokeWidth="2" />
                  <text x={x2} y="235" fontSize="9" fontWeight="bold" fill={d.isMatched ? "#d97706" : "#ef4444"} textAnchor="middle">A-{d.id2}</text>
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
                    <g key={`2d-match-${i}`}>
                      <line x1={cx1} y1={cy1} x2={cx2} y2={cy2} stroke="#fca5a5" strokeWidth="1" strokeDasharray="2 2" />
                      <rect 
                        x={cx1 - w1/2} y={cy1 - h1/2} width={w1} height={h1} rx="2"
                        fill={d.isExt1 ? "rgba(148, 163, 184, 0.4)" : "transparent"} 
                        stroke="#94a3b8" strokeWidth={d.isExt1 ? "1" : "2"} strokeDasharray={d.isExt1 ? "0" : "2"}
                      />
                      <rect 
                        x={cx2 - w2/2} y={cy2 - h2/2} width={w2} height={h2} rx="2"
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
                    <g key={`2d-unmatch-${i}`}>
                      <rect 
                        x={cx - w/2} y={cy - h/2} width={w} height={h} rx="2"
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
             
             <group rotation={[Math.PI / 2, 0, 0]}>
               {/* Semi-transparent Glass-like Pipeline Cylinder */}
               <mesh>
                 <cylinderGeometry args={[2, 2, renderLength, 48, 1, false]} />
                 <meshStandardMaterial color="#cbd5e1" metalness={0.2} roughness={0.1} transparent opacity={0.65} side={2} />
               </mesh>
               
               {/* FEA-style Mesh Grid Wireframe */}
               <mesh>
                 <cylinderGeometry args={[2.02, 2.02, renderLength, 36, Math.ceil(renderLength * 2), true]} />
                 <meshBasicMaterial color="#334155" wireframe transparent opacity={0.5} />
               </mesh>

               {/* Girth Welds Rings */}
               {Array.from({ length: Math.ceil(renderLength / gwDistance) + 1 }).map((_, i) => {
                 const y = (-renderLength / 2) + (i * gwDistance);
                 if (y > renderLength / 2) return null; // safety bounds
                 return (
                   <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} key={`gw-ring-${i}`}>
                     <torusGeometry args={[2.02, 0.05, 16, 48]} />
                     <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.5} />
                   </mesh>
                 );
               })}

               {/* Defects mapped onto the cylinder */}
               {spoolData.map((d, i) => {
                 const yPos = (dist: number) => ((dist - selectedRange.startDist) / sLength) * renderLength - (renderLength/2); 
                 const rad = (orient: number) => (orient * Math.PI) / 180;
                 
                 const drawMarker = (dist: number, orient: number, isExt: boolean, depth: number, suffix: string) => {
                   const y = yPos(dist);
                   const theta = rad(orient);
                   
                   // External = protrudes out at r=2.08, Internal = protrudes in at r=1.92
                   const r = isExt ? 2.08 : 1.92; 
                   const x = r * Math.sin(theta);
                   const z = r * Math.cos(theta);
                   
                   // Determine color by depth (Mock depth: yellow < 20, orange 20-40, red 40-70, darkred > 70)
                   // But wait, our mock depth from the CSV was originally floating point like 1.5, 0.6.
                   // Let's normalize it for the visualizer. Assuming max depth is around 2.0 in our mocked data.
                   // Let's just use strict numeric boundaries.
                   let color = "#eab308"; // Yellow (Shallow)
                   if (depth > 0.5) color = "#f97316"; // Orange (Medium)
                   if (depth > 1.0) color = "#ef4444"; // Red (Deep)
                   if (depth > 1.5) color = "#991b1b"; // Dark Red (Critical)

                   return (
                     <mesh position={[x, y, z]} key={`3d-anom-${i}-${suffix}`}>
                       <boxGeometry args={[0.3, 0.6, 0.3]} />
                       <meshStandardMaterial color={color} />
                     </mesh>
                   );
                 };

                 const markers = [];
                 if (d.dist1 !== null) markers.push(drawMarker(d.dist1, d.orient1, d.isExt1, d.depth1, 'old'));
                 if (d.dist2 !== null) markers.push(drawMarker(d.dist2, d.orient2, d.isExt2, d.depth2, 'new'));
                 return markers;
               })}
             </group>
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
              Alignment Timeline Viewer (12+ km)
            </h3>
            <p className="text-sm text-gray-500 font-medium mt-1">
              Select a spool segment between Girth Welds to view 2D/3D details.
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

    </div>
  );
}
