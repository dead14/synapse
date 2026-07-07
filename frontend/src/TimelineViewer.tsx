import React, { useState } from 'react';

export default function TimelineViewer() {
  const [ota, setOta] = useState(1.5);
  const [zoom, setZoom] = useState(1);

  // Generate mock data for the timeline (e.g. 30 Girth Welds = ~360m of pipeline)
  const numGws = 30;
  const gwDistance = 12.0;
  const totalDistance = numGws * gwDistance;
  
  // Base width of the SVG in pixels, multiplied by zoom
  const baseWidth = 1200;
  const svgWidth = baseWidth * zoom;

  // Function to convert meters to X coordinate in SVG
  const mToX = (meters: number) => (meters / totalDistance) * svgWidth;

  const oldGws = [];
  const newGws = [];
  const oldAnomalies = [];
  const newAnomalies = [];

  // Generate Girth Welds and some random anomalies
  let currentOffset = 0.1; // Accumulating odometer error for Run New
  
  for (let i = 0; i <= numGws; i++) {
    const oldDist = i * gwDistance;
    oldGws.push(oldDist);
    
    // Run New has an odometer error that accumulates
    const newDist = oldDist + currentOffset;
    newGws.push(newDist);
    currentOffset += 0.05 + (Math.random() * 0.1); // add a little error per joint

    // Randomly add an anomaly between this GW and the next
    if (i < numGws && Math.random() > 0.6) {
      // Anomaly somewhere in the middle of the spool
      const offsetInSpool = 2 + Math.random() * 8; 
      oldAnomalies.push(oldDist + offsetInSpool);
      // Matching anomaly in new run, slightly shifted
      newAnomalies.push(newDist + offsetInSpool + (Math.random() * 0.2 - 0.1));
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-8 hover:shadow-md transition-shadow">
      {/* Description & OTA Slider */}
      <div className="flex flex-col gap-4">
        <p className="text-gray-600 text-sm font-medium">
          Adjust the OTA % slider to see how the algorithm filters out local pipeline anomalies (like repair spools) vs how it forces matches.
        </p>
        <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-100 rounded-xl p-5 w-fit min-w-[400px] shadow-inner">
          <h3 className="text-sm font-bold text-gray-700 mb-4">Odometer Tracking Accuracy (OTA) Threshold</h3>
          <div className="flex items-center gap-4">
            <input 
              type="range" 
              min="0.1" max="5.0" step="0.1" 
              value={ota} 
              onChange={e => setOta(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="bg-white border border-gray-200 text-blue-600 font-extrabold px-3 py-1 rounded shadow-sm text-sm">
              {ota.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Viewer */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-end">
          <h3 className="text-sm font-bold text-gray-700">Timeline Viewer (12+ km)</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-gray-400">Zoom:</span>
            <input 
              type="range" 
              min="1" max="5" step="0.1" 
              value={zoom} 
              onChange={e => setZoom(parseFloat(e.target.value))}
              className="w-32 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-500"
            />
          </div>
        </div>
        
        {/* Timeline Container (Scrollable) */}
        <div className="border border-gray-100 rounded-xl overflow-x-auto bg-[#fafbfc] shadow-inner">
          <div style={{ width: svgWidth, minWidth: '100%', height: '280px' }} className="relative transition-all duration-300">
            <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
              
              {/* --- RUN OLD (REFERENCE) --- */}
              <text x="20" y="40" className="text-xs font-extrabold fill-gray-400 tracking-wider">RUN OLD (REFERENCE)</text>
              {/* Main horizontal pipe line */}
              <line x1="0" y1="80" x2="100%" y2="80" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
              
              {/* GW Ticks */}
              {oldGws.map((gw, i) => {
                const x = mToX(gw);
                return (
                  <g key={`old-gw-${i}`}>
                    {/* Vertical Line across both tracks to show alignment guides */}
                    <line x1={x} y1="80" x2={x} y2="210" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                    {/* GW Marker */}
                    <rect x={x - 3} y="60" width="6" height="40" rx="3" fill="#10b981" className="drop-shadow-sm" />
                    {/* Label */}
                    <text x={x} y="115" fontSize="10" fontWeight="bold" fill="#059669" textAnchor="middle">
                      {gw.toFixed(2)}m
                    </text>
                  </g>
                );
              })}

              {/* Anomalies */}
              {oldAnomalies.map((anom, i) => (
                <g key={`old-anom-${i}`} className="cursor-pointer">
                  <circle cx={mToX(anom)} cy="80" r="6" fill="#ef4444" stroke="#ffffff" strokeWidth="2" className="drop-shadow" />
                  <text x={mToX(anom)} y="55" fontSize="9" fontWeight="bold" fill="#ef4444" textAnchor="middle">A-{i+1}</text>
                </g>
              ))}


              {/* --- RUN NEW (CURRENT) --- */}
              <text x="20" y="170" className="text-xs font-extrabold fill-gray-400 tracking-wider">RUN NEW (CURRENT)</text>
              {/* Main horizontal pipe line */}
              <line x1="0" y1="210" x2="100%" y2="210" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
              
              {/* GW Ticks */}
              {newGws.map((gw, i) => {
                const x = mToX(gw);
                return (
                  <g key={`new-gw-${i}`}>
                    {/* GW Marker */}
                    <rect x={x - 3} y="190" width="6" height="40" rx="3" fill="#3b82f6" className="drop-shadow-sm" />
                    {/* Label */}
                    <text x={x} y="245" fontSize="10" fontWeight="bold" fill="#2563eb" textAnchor="middle">
                      {gw.toFixed(2)}m
                    </text>
                  </g>
                );
              })}

              {/* Anomalies */}
              {newAnomalies.map((anom, i) => {
                // If it falls within OTA threshold of old anomaly, draw match line
                const matchedOld = oldAnomalies[i]; 
                const xNew = mToX(anom);
                const xOld = mToX(matchedOld);
                
                return (
                  <g key={`new-anom-${i}`} className="cursor-pointer">
                    {/* Match line connecting them */}
                    <line x1={xOld} y1="80" x2={xNew} y2="210" stroke="#fca5a5" strokeWidth="2" strokeDasharray="4 4" />
                    <circle cx={xNew} cy="210" r="6" fill="#ef4444" stroke="#ffffff" strokeWidth="2" className="drop-shadow" />
                    <text x={xNew} y="235" fontSize="9" fontWeight="bold" fill="#ef4444" textAnchor="middle">A-{i+1}</text>
                  </g>
                );
              })}

            </svg>
          </div>
        </div>

      </div>
    </div>
  );
}
