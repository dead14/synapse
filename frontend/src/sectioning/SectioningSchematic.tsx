import React, { useEffect, useRef } from 'react';
import { SectionDef } from './IliSectioningPage';

interface SchematicProps {
  features: {
    gws: any[];
    allFeatures: any[];
    stats: { totalLength: number; gwCount: number; bendCount: number };
  };
  sections: SectionDef[];
  zoom: number;
  selectedGWs: any[];
  onGwClick: (gw: any) => void;
}

export default function SectioningSchematic({ features, sections, zoom, selectedGWs, onGwClick }: SchematicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Base constants
  const pixelsPerMeter = 2 * zoom; // Adjust base scale as needed
  const totalWidth = features.stats.totalLength * pixelsPerMeter + 200; // 200px padding
  
  // Calculate X position based on distance
  const getX = (dist: number) => {
    return dist * pixelsPerMeter + 100; // 100px left padding
  };

  // Helper to color feature marks
  const getFeatureColor = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('weld')) return '#2dd4bf'; // Cyan for GW
    if (t.includes('bend')) return '#f59e0b'; // Orange for Bend (simplified logic for now)
    if (t.includes('jog')) return '#fde047'; // Yellow
    if (t.includes('crossing') && t.includes('bend')) return '#c084fc'; // Purple
    if (t.includes('riser')) return '#ef4444'; // Red
    if (t.includes('valve')) return '#3b82f6'; // Blue
    if (t.includes('casing')) return '#94a3b8'; // Grey
    return 'transparent'; // Hide others
  };

  // Helper to color sections
  const getSectionColor = (type: string) => {
    switch (type) {
      case 'RL': return '#2dd4bf'; // River
      case 'AL': return '#60a5fa'; // Aerial
      case 'RIS': return '#ef4444'; // Riser
      case 'ROC': return '#fb923c'; // Road
      case 'BUR': return '#a3e635'; // Buried
      case 'CAS': return '#94a3b8'; // Cased
      default: return '#c084fc';
    }
  };

  return (
    <div className="w-full h-full overflow-auto custom-scrollbar relative bg-gray-50/50" ref={containerRef}>
      <div 
        className="relative h-full" 
        style={{ width: `${Math.max(totalWidth, 1000)}px`, minHeight: '400px' }}
      >
        {/* Main Pipeline Axis */}
        <div className="absolute top-[50%] left-0 right-0 h-[2px] bg-gray-200 -translate-y-1/2"></div>
        
        {/* Distance Markers (Every 100m) */}
        {Array.from({ length: Math.ceil(features.stats.totalLength / 100) + 1 }).map((_, i) => {
          const m = i * 100;
          return (
            <div key={`marker-${m}`} className="absolute top-[35%] flex flex-col items-center" style={{ left: getX(m), transform: 'translateX(-50%)' }}>
               <span className="text-[10px] text-gray-400 font-mono mb-2">{m}</span>
               <div className="w-[2px] h-4 bg-gray-300"></div>
            </div>
          );
        })}

        {/* Sections Highlights (Below Axis) */}
        {sections.map(sec => {
          const x1 = getX(sec.startM);
          const x2 = getX(sec.endM);
          const width = x2 - x1;
          const color = getSectionColor(sec.type);
          
          return (
            <div 
              key={sec.id}
              className="absolute top-[55%] flex items-center justify-center cursor-pointer hover:brightness-110 transition-all rounded-sm shadow-sm"
              style={{ left: x1, width: width, height: '24px', backgroundColor: color, opacity: 0.85 }}
              title={`${sec.name} (${sec.type})`}
            >
              {width > 100 && (
                <span className="text-[10px] font-bold text-white uppercase truncate px-2 drop-shadow-md">
                  {sec.name}
                </span>
              )}
            </div>
          );
        })}

        {/* Selected GW Highlight Range */}
        {selectedGWs.length === 2 && (
          <div 
            className="absolute top-[48%] h-4 bg-blue-500/20 border-y border-blue-500/50 z-10 animate-pulse"
            style={{ 
              left: getX(Math.min(selectedGWs[0].dist, selectedGWs[1].dist)), 
              width: Math.abs(getX(selectedGWs[1].dist) - getX(selectedGWs[0].dist)) 
            }}
          />
        )}

        {/* Features / GW Tick Marks */}
        {features.allFeatures.map((f, i) => {
          const color = getFeatureColor(f.type);
          if (color === 'transparent') return null;
          
          const isGW = f.type.toLowerCase().includes('weld');
          const isSelected = selectedGWs.some(gw => gw.id === f.id);
          
          return (
            <div 
              key={f.id || i}
              className={`absolute top-[50%] flex flex-col items-center ${isGW ? 'cursor-pointer hover:scale-150' : ''} z-20 transition-transform`}
              style={{ left: getX(f.dist), transform: 'translate(-50%, -50%)' }}
              onClick={() => isGW && onGwClick(f)}
              title={`${f.type} at ${f.dist.toFixed(2)}m (ID: ${f.id})`}
            >
              <div 
                className={`w-[2px] ${isSelected ? 'h-10 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : isGW ? 'h-6' : 'h-4'} transition-all`}
                style={{ backgroundColor: isSelected ? undefined : color }}
              ></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
