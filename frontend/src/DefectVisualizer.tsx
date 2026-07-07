import React, { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { FiBox, FiX } from 'react-icons/fi';

interface DefectVisualizerProps {
  data: any[];
}

export default function DefectVisualizer({ data }: DefectVisualizerProps) {
  const [zoom, setZoom] = useState(1);
  const [selectedSpool, setSelectedSpool] = useState<{ index: number, startDist: number, endDist: number, length: number } | null>(null);
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
        isExt1,
        
        id2: item['Unnamed: 2'] || '',
        dist2: isNaN(r2Dist) ? null : r2Dist,
        len2: parseFloat(item['Unnamed: 8']) || 10,
        wid2: parseFloat(item['Unnamed: 5']) || 10,
        orient2: parseFloat(item['Unnamed: 7']) || 0,
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
  
  // Render functions
  const render1DTimeline = () => {
    return (
      <div className="border border-gray-100 rounded-xl overflow-x-auto bg-[#fafbfc] shadow-inner">
        <div style={{ width: svgWidth, minWidth: '100%', height: '280px' }} className="relative transition-all duration-300">
          <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* --- RUN OLD (REFERENCE) --- */}
            <text x="20" y="40" className="text-xs font-extrabold fill-gray-400 tracking-wider">RUN OLD (REFERENCE)</text>
            <line x1="0" y1="80" x2="100%" y2="80" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
            
            {/* Draw GW Ticks & Spool Hitboxes */}
            {Array.from({ length: numGws }).map((_, i) => {
               const dist1 = startDist + i * gwDistance;
               const dist2 = startDist + (i + 1) * gwDistance;
               const x1 = mToX(dist1);
               const x2 = mToX(dist2);
               const isSelected = selectedSpool?.index === i;
               const color = isSelected ? "#eab308" : "#10b981"; // yellow-500 or emerald-500
               
               return (
                 <g key={`gw-1-${i}`}>
                   {/* Spool Hitbox */}
                   <rect 
                     x={x1} y="65" width={x2 - x1} height="30" 
                     fill={isSelected ? "rgba(253, 224, 71, 0.3)" : "transparent"} 
                     className="cursor-pointer hover:fill-yellow-100/50 transition-colors"
                     onClick={() => setSelectedSpool({ index: i, startDist: dist1, endDist: dist2, length: gwDistance })}
                   />
                   
                   {/* Highlighted connecting line if selected */}
                   {isSelected && (
                     <line x1={x1} y1="80" x2={x2} y2="80" stroke="#eab308" strokeWidth="6" strokeLinecap="round" />
                   )}

                   {/* Alignment guide */}
                   <line x1={x1} y1="80" x2={x1} y2="210" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                   
                   {/* GW Marker */}
                   <rect x={x1 - 3} y="60" width="6" height="40" rx="3" fill={color} />
                   <text x={x1} y="115" fontSize="10" fontWeight="bold" fill={color} textAnchor="middle">{dist1.toFixed(2)}m</text>
                 </g>
               );
            })}
            
            {/* Draw the very last GW marker */}
            <g>
              <rect x={mToX(startDist + numGws * gwDistance) - 3} y="60" width="6" height="40" rx="3" fill="#10b981" />
              <text x={mToX(startDist + numGws * gwDistance)} y="115" fontSize="10" fontWeight="bold" fill="#059669" textAnchor="middle">
                {(startDist + numGws * gwDistance).toFixed(2)}m
              </text>
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
               const isSelected = selectedSpool?.index === i || selectedSpool?.index === i - 1; // Highlight related new GWs
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
    if (!selectedSpool) return null;
    
    // Filter data to only those inside the spool (using Run 1 distance as reference)
    const spoolData = parsedData.filter(d => {
      if (d === null) return false;
      const dist = d.dist1 !== null ? d.dist1 : d.dist2; // Fallback to dist2 if unmatched new
      if (dist === null) return false;
      return dist >= selectedSpool.startDist && dist <= selectedSpool.endDist;
    });

    const sLength = selectedSpool.length;
    // For 2D SVG rendering inside modal (fixed width)
    const modalSvgWidth = 800;
    const sToX = (dist: number) => {
      return ((dist - selectedSpool.startDist) / sLength) * modalSvgWidth;
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
      return (
        <div className="w-full h-[400px] bg-[#1e293b] rounded-xl overflow-hidden relative shadow-inner">
           <div className="absolute top-4 left-4 z-10 text-white/70 text-xs">Left Click: Rotate | Right Click: Pan | Scroll: Zoom</div>
           <Canvas camera={{ position: [0, 0, 10], fov: 45 }}>
             <ambientLight intensity={0.5} />
             <directionalLight position={[10, 10, 10]} intensity={1} />
             <OrbitControls enableDamping dampingFactor={0.05} />
             
             <group rotation={[Math.PI / 2, 0, 0]}>
               {/* 12m Pipe Cylinder */}
               <mesh>
                 <cylinderGeometry args={[2, 2, 12, 32, 1, false]} />
                 <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
               </mesh>
               <mesh>
                 <cylinderGeometry args={[2.01, 2.01, 12, 12, 10, true]} />
                 <meshBasicMaterial color="#334155" wireframe transparent opacity={0.3} />
               </mesh>

               {/* Defects mapped onto the 12m cylinder */}
               {spoolData.map((d, i) => {
                 const yPos = (dist: number) => ((dist - selectedSpool.startDist) / sLength) * 12 - 6; // Center is 0, so -6 to +6
                 const rad = (orient: number) => (orient * Math.PI) / 180;
                 
                 const drawMarker = (dist: number, orient: number, isNew: boolean, isExt: boolean) => {
                   const y = yPos(dist);
                   const theta = rad(orient);
                   const r = 2.05; 
                   const x = r * Math.sin(theta);
                   const z = r * Math.cos(theta);
                   const color = isNew ? "#ef4444" : (d.isMatched ? "#f59e0b" : "#3b82f6");

                   return (
                     <mesh position={[x, y, z]} key={`3d-anom-${i}-${isNew}`}>
                       <boxGeometry args={[0.3, 0.6, 0.3]} />
                       <meshStandardMaterial color={color} />
                     </mesh>
                   );
                 };

                 const markers = [];
                 if (d.dist1 !== null) markers.push(drawMarker(d.dist1, d.orient1, false, d.isExt1));
                 if (d.dist2 !== null) markers.push(drawMarker(d.dist2, d.orient2, true, d.isExt2));
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
          {selectedSpool && (
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-300">
              <div className="px-4 py-2 bg-yellow-50 text-yellow-700 border border-yellow-200 font-bold rounded-full text-sm">
                Spool Length: {selectedSpool.length.toFixed(2)}m
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
                <p className="text-sm text-gray-500 font-medium">Distance: {selectedSpool?.startDist.toFixed(2)}m to {selectedSpool?.endDist.toFixed(2)}m</p>
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
