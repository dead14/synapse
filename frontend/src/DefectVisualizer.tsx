import React, { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

type ViewMode = '1D' | '2D' | '3D';

interface DefectVisualizerProps {
  data: any[];
}

export default function DefectVisualizer({ data }: DefectVisualizerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('1D');
  const [zoom, setZoom] = useState(1);

  // Parse data into usable array of objects
  const parsedData = useMemo(() => {
    return data.map(item => {
      // Basic check
      if (!item) return null;
      
      const r1Dist = parseFloat(item['DATA LAMA 2020 (Vendor Lama)  >']);
      const r2Dist = parseFloat(item['<  DATA BARU 2025 (Vendor Baru)']);
      const isMatched = !isNaN(r1Dist) && !isNaN(r2Dist);
      
      // Determine Int/Ext. Mocking: if depth > 1.0 we say Ext, else Int (just for visual variation)
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
  const minDistance = Math.min(...parsedData.flatMap(d => [d.dist1, d.dist2]).filter(d => d !== null) as number[]);
  const maxDistance = Math.max(...parsedData.flatMap(d => [d.dist1, d.dist2]).filter(d => d !== null) as number[]);
  const totalLength = Math.max(10, maxDistance - minDistance + 20); // Add padding
  const startDist = Math.max(0, minDistance - 10);

  // Provide a much wider base scale so defects aren't squished together on long pipelines
  const baseWidth = Math.max(1200, totalLength * 5); // 5 pixels per meter at 1x zoom
  const svgWidth = baseWidth * zoom;
  
  const mToX = (meters: number) => {
    return ((meters - startDist) / totalLength) * svgWidth;
  };
  
  // Render functions for different views
  const render1DTimeline = () => {
    return (
      <div className="border border-gray-100 rounded-xl overflow-x-auto bg-[#fafbfc] shadow-inner">
        <div style={{ width: svgWidth, minWidth: '100%', height: '280px' }} className="relative transition-all duration-300">
          <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* --- RUN OLD (REFERENCE) --- */}
            <text x="20" y="40" className="text-xs font-extrabold fill-gray-400 tracking-wider">RUN OLD (REFERENCE)</text>
            <line x1="0" y1="80" x2="100%" y2="80" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
            
            {/* Draw GW Ticks (mocked every 12m for visual structure) */}
            {Array.from({ length: Math.ceil(totalLength / 12) + 1 }).map((_, i) => {
               const dist = startDist + i * 12;
               const x = mToX(dist);
               return (
                 <g key={`gw-1-${i}`}>
                   <line x1={x} y1="80" x2={x} y2="210" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                   <rect x={x - 3} y="60" width="6" height="40" rx="3" fill="#10b981" />
                   <text x={x} y="115" fontSize="10" fontWeight="bold" fill="#059669" textAnchor="middle">{dist.toFixed(2)}m</text>
                 </g>
               );
            })}

            {/* Run 1 Anomalies */}
            {parsedData.map((d, i) => {
              if (d.dist1 === null) return null;
              const x = mToX(d.dist1);
              return (
                <g key={`anom1-${i}`} className="cursor-pointer">
                  <circle cx={x} cy="80" r="6" fill={d.isMatched ? "#f59e0b" : "#ef4444"} stroke="#ffffff" strokeWidth="2" />
                  <text x={x} y="55" fontSize="9" fontWeight="bold" fill={d.isMatched ? "#d97706" : "#ef4444"} textAnchor="middle">ID:{d.id1}</text>
                </g>
              );
            })}

            {/* --- RUN NEW (CURRENT) --- */}
            <text x="20" y="170" className="text-xs font-extrabold fill-gray-400 tracking-wider">RUN NEW (CURRENT)</text>
            <line x1="0" y1="210" x2="100%" y2="210" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
            
            {/* Draw Run 2 GW Ticks (mock offset) */}
            {Array.from({ length: Math.ceil(totalLength / 12) + 1 }).map((_, i) => {
               const dist = startDist + (i * 12) + (i * 0.05); // slightly offset
               const x = mToX(dist);
               return (
                 <g key={`gw-2-${i}`}>
                   <rect x={x - 3} y="190" width="6" height="40" rx="3" fill="#3b82f6" />
                   <text x={x} y="245" fontSize="10" fontWeight="bold" fill="#2563eb" textAnchor="middle">{dist.toFixed(2)}m</text>
                 </g>
               );
            })}

            {/* Run 2 Anomalies */}
            {parsedData.map((d, i) => {
              if (d.dist2 === null) return null;
              const x2 = mToX(d.dist2);
              
              return (
                <g key={`anom2-${i}`} className="cursor-pointer">
                  {/* Match line */}
                  {d.isMatched && d.dist1 !== null && (
                    <line x1={mToX(d.dist1)} y1="80" x2={x2} y2="210" stroke="#fca5a5" strokeWidth="2" strokeDasharray="4 4" />
                  )}
                  <circle cx={x2} cy="210" r="6" fill={d.isMatched ? "#f59e0b" : "#ef4444"} stroke="#ffffff" strokeWidth="2" />
                  <text x={x2} y="235" fontSize="9" fontWeight="bold" fill={d.isMatched ? "#d97706" : "#ef4444"} textAnchor="middle">ID:{d.id2}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  const render2DUnrolled = () => {
    // Y-axis is orientation (0 to 360). 0=top, 360=bottom.
    // Let's use 300px height for the pipe surface.
    const pipeHeight = 360; 
    const oToY = (orient: number) => (orient / 360) * pipeHeight;

    return (
      <div className="border border-gray-100 rounded-xl overflow-x-auto bg-[#fafbfc] shadow-inner relative">
        <div style={{ width: svgWidth, minWidth: '100%', height: `${pipeHeight + 60}px` }} className="relative transition-all duration-300">
          <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* Draw clock guides */}
            {[0, 90, 180, 270, 360].map((deg) => {
              const y = oToY(deg) + 30; // 30px top padding
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

            {/* Draw defects */}
            {parsedData.map((d, i) => {
              // Logic: Draw overlapping rectangles for matched to show growth.
              // We'll scale length and width for visibility. 
              // (Assuming width/length are in mm, we'll give them a min size of pixels)
              
              const scaleDim = (val: number) => Math.max(8, val * 0.5); 

              if (d.isMatched && d.dist1 !== null && d.dist2 !== null) {
                const cx1 = mToX(d.dist1);
                const cy1 = oToY(d.orient1) + 30;
                const w1 = scaleDim(d.len1); // length usually axial (X)
                const h1 = scaleDim(d.wid1); // width usually circumferential (Y)

                const cx2 = mToX(d.dist2);
                const cy2 = oToY(d.orient2) + 30;
                const w2 = scaleDim(d.len2);
                const h2 = scaleDim(d.wid2);

                return (
                  <g key={`2d-match-${i}`}>
                    {/* Connection line showing migration (if any) */}
                    <line x1={cx1} y1={cy1} x2={cx2} y2={cy2} stroke="#fca5a5" strokeWidth="1" strokeDasharray="2 2" />
                    
                    {/* Old Defect (Run 1) - Grey outline or solid */}
                    <rect 
                      x={cx1 - w1/2} y={cy1 - h1/2} width={w1} height={h1} rx="2"
                      fill={d.isExt1 ? "rgba(148, 163, 184, 0.4)" : "transparent"} 
                      stroke="#94a3b8" strokeWidth={d.isExt1 ? "1" : "2"} strokeDasharray={d.isExt1 ? "0" : "2"}
                    />
                    
                    {/* New Defect (Run 2) - Red overlay showing growth */}
                    <rect 
                      x={cx2 - w2/2} y={cy2 - h2/2} width={w2} height={h2} rx="2"
                      fill={d.isExt2 ? "rgba(239, 68, 68, 0.6)" : "transparent"} 
                      stroke="#ef4444" strokeWidth={d.isExt2 ? "1" : "2"} strokeDasharray={d.isExt2 ? "0" : "2"}
                    />
                    
                    {/* Growth visual indicator (if length or width increased) */}
                    {(d.len2 > d.len1 || d.wid2 > d.wid1) && (
                       <text x={cx2} y={cy2 - h2/2 - 5} fontSize="9" fill="#b91c1c" fontWeight="bold" textAnchor="middle">
                         Growth!
                       </text>
                    )}
                  </g>
                );
              } else {
                // Unmatched defects
                const isRun1 = d.dist1 !== null;
                const cx = isRun1 ? mToX(d.dist1 as number) : mToX(d.dist2 as number);
                const cy = isRun1 ? oToY(d.orient1) + 30 : oToY(d.orient2) + 30;
                const w = scaleDim(isRun1 ? d.len1 : d.len2);
                const h = scaleDim(isRun1 ? d.wid1 : d.wid2);
                const isExt = isRun1 ? d.isExt1 : d.isExt2;
                const color = isRun1 ? "#3b82f6" : "#f59e0b"; // blue for old unmatched, orange for new unmatched

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
  };

  const render3DPipe = () => {
    return (
      <div className="border border-gray-100 rounded-xl overflow-hidden bg-[#1e293b] shadow-inner h-[400px] relative">
         <div className="absolute top-4 left-4 z-10 text-white/70 text-xs">Left Click: Rotate | Right Click: Pan | Scroll: Zoom</div>
         <Canvas camera={{ position: [0, 0, 15], fov: 45 }}>
           <ambientLight intensity={0.5} />
           <directionalLight position={[10, 10, 10]} intensity={1} />
           
           <OrbitControls enableDamping dampingFactor={0.05} />
           
           <group rotation={[Math.PI / 2, 0, 0]}>
             {/* The Pipeline Cylinder */}
             {/* Length we compress slightly for viewing, radius = 2 */}
             <mesh>
               <cylinderGeometry args={[2, 2, 20, 32, 1, false]} />
               <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
             </mesh>

             {/* Wireframe overlay to show grid */}
             <mesh>
               <cylinderGeometry args={[2.01, 2.01, 20, 12, 10, true]} />
               <meshBasicMaterial color="#334155" wireframe transparent opacity={0.3} />
             </mesh>

             {/* Defects on surface */}
             {parsedData.map((d, i) => {
               // To map to 3D cylinder: 
               // Y goes along the cylinder length (-10 to 10 mapped from min/max distance)
               // X and Z are calculated from orientation (theta)
               // Theta is 0 at 12 o'clock (usually +Z or +Y depending on rotation).
               
               const yPos = (dist: number) => ((dist - minDistance) / totalLength) * 20 - 10;
               const rad = (orient: number) => (orient * Math.PI) / 180;
               
               const drawMarker = (dist: number, orient: number, isNew: boolean, isExt: boolean) => {
                 const y = yPos(dist);
                 const theta = rad(orient);
                 // 12 o'clock is top -> +Z axis if cylinder is along Y
                 const r = 2.05; // slightly above surface
                 const x = r * Math.sin(theta);
                 const z = r * Math.cos(theta);
                 
                 const color = isNew ? "#ef4444" : (d.isMatched ? "#f59e0b" : "#3b82f6");

                 return (
                   <mesh position={[x, y, z]} key={`3d-anom-${i}-${isNew}`}>
                     <boxGeometry args={[0.2, 0.4, 0.2]} />
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
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-6 hover:shadow-md transition-shadow">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h3 className="text-xl font-extrabold text-gray-800 bg-gradient-to-r from-gray-900 to-gray-500 bg-clip-text text-transparent">
            Defect Visualizer (2D / 3D)
          </h3>
          <p className="text-sm text-gray-500 font-medium mt-1">
            Observe defect positions, orientation, and growth between inspections.
          </p>
        </div>
        
        {/* Toggles */}
        <div className="flex flex-col gap-3">
          <div className="flex bg-gray-100 p-1 rounded-xl w-fit shadow-inner border border-gray-200">
            {(['1D', '2D', '3D'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-5 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  viewMode === mode 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                }`}
              >
                {mode === '1D' ? '1D Timeline' : mode === '2D' ? '2D Unrolled' : '3D Pipe'}
              </button>
            ))}
          </div>
          
          {(viewMode === '1D' || viewMode === '2D') && (
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
          )}
        </div>
      </div>

      {/* Dynamic View Container */}
      <div className="mt-2">
        {viewMode === '1D' && render1DTimeline()}
        {viewMode === '2D' && render2DUnrolled()}
        {viewMode === '3D' && render3DPipe()}
      </div>
      
      {/* Legend */}
      {viewMode === '2D' && (
         <div className="flex gap-6 mt-2 justify-center border-t border-gray-100 pt-4">
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
  );
}
