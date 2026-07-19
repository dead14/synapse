import { useMemo, useRef } from 'react';
import type { SectionDef, SpatialFeatures, SpatialFeature } from './types';
import WeldTable from './WeldTable';

interface SchematicProps {
  features: SpatialFeatures;
  sections: SectionDef[];
  zoom: number;
  selectedGWs: SpatialFeature[];
  onGwClick: (gw: SpatialFeature) => void;
  onZoomChange: (zoom: number) => void;
  inspectedGw?: SpatialFeature | null;
  onInspectGw?: (gw: SpatialFeature | null) => void;
  selectUnmatched?: boolean;
  selectionEnabled?: boolean;
}

interface Point { x: number; y: number }
interface BendGeometry {
  feature: SpatialFeature;
  point: Point;
  angleDeg: number;
  inferred: boolean;
}
interface RouteGeometry {
  width: number;
  routeHeight: number;
  bends: BendGeometry[];
  path: string;
  positionAt: (distance: number) => Point & { unit: Point };
  rangePath: (startM: number, endM: number) => string;
}

const sectionColor = (type: string) => ({
  RL: '#2dd4bf',
  AL: '#60a5fa',
  RIS: '#ef4444',
  ROC: '#fb923c',
  BUR: '#84cc16',
  CAS: '#94a3b8',
  UNCLASSIFIED: '#cbd5e1',
  OTH: '#c084fc',
}[type] || '#c084fc');

const featureColor = (type: string) => {
  const normalized = type.toLowerCase();
  if (/weld|girth|seam|gw/.test(normalized)) return '#00c853';
  if (normalized.includes('bend')) return '#f59e0b';
  if (normalized.includes('jog')) return '#eab308';
  if (normalized.includes('riser')) return '#ef4444';
  if (normalized.includes('valve')) return '#2563eb';
  if (normalized.includes('casing')) return '#64748b';
  return 'transparent';
};

function readRawNumber(feature: SpatialFeature, patterns: RegExp[]): number | null {
  for (const [key, rawValue] of Object.entries(feature.rawData || {})) {
    const normalizedKey = key.toLowerCase().replaceAll('_', ' ');
    if (!patterns.some((pattern) => pattern.test(normalizedKey))) continue;
    const value = Number.parseFloat(String(rawValue ?? '').replace(',', '.'));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function bendDefinition(feature: SpatialFeature) {
  const angleFromColumn = readRawNumber(feature, [/bend.*angle/, /deflection/, /^angle$/, /degree/]);
  const angleFromType = Number.parseFloat(feature.type.match(/(?:bend|elbow)[^0-9]*(\d+(?:\.\d+)?)/i)?.[1] || '');
  const angleDeg = Math.max(5, Math.min(175, angleFromColumn ?? (Number.isFinite(angleFromType) ? angleFromType : 90)));
  const radiusM = readRawNumber(feature, [/bend.*radius/, /^radius$/, /radius.*m/]);
  let turnSign: 1 | -1 | null = null;
  for (const [key, rawValue] of Object.entries(feature.rawData || {})) {
    if (!/direction|turn|clockwise|bend.*dir/i.test(key)) continue;
    const value = String(rawValue || '').toLowerCase();
    if (/left|counter|ccw|kiri/.test(value)) turnSign = -1;
    if (/right|clockwise|cw|kanan/.test(value)) turnSign = 1;
  }
  return { angleDeg, radiusM, turnSign, inferred: angleFromColumn === null && !Number.isFinite(angleFromType) };
}

function formatWallThickness(feature: SpatialFeature) {
  return Number.isFinite(feature.wallThicknessMm as number) ? `${Number(feature.wallThicknessMm).toFixed(1)} mm` : null;
}

function isThicknessChange(feature: SpatialFeature, prev?: SpatialFeature, next?: SpatialFeature) {
  const current = feature.wallThicknessMm;
  if (!Number.isFinite(current as number)) return false;
  const prevValue = prev?.wallThicknessMm;
  const nextValue = next?.wallThicknessMm;
  return (
    (Number.isFinite(prevValue as number) && Number(prevValue) !== Number(current)) ||
    (Number.isFinite(nextValue as number) && Number(nextValue) !== Number(current))
  );
}

function buildRouteGeometry(features: SpatialFeatures, zoom: number): RouteGeometry {
  const totalLength = Math.max(features.stats.totalLength, 1);
  const scale = Math.max(0.08, 0.32 * zoom);
  const paddingX = 90;
  const baselineY = 125;
  const bendFeatures = features.allFeatures
    .filter((feature) => feature.type.toLowerCase().includes('bend') && feature.dist > 0 && feature.dist < totalLength)
    .sort((left, right) => left.dist - right.dist)
    .filter((feature, index, list) => index === 0 || Math.abs(feature.dist - list[index - 1].dist) > 0.001);
  const bends: BendGeometry[] = bendFeatures.map((feature) => {
    const definition = bendDefinition(feature);
    return {
      feature,
      point: { x: paddingX + feature.dist * scale, y: baselineY },
      angleDeg: definition.angleDeg,
      inferred: definition.inferred,
    };
  });

  const positionAt = (distance: number) => {
    const clamped = Math.max(0, Math.min(totalLength, distance));
    return {
      x: paddingX + clamped * scale,
      y: baselineY,
      unit: { x: 1, y: 0 },
    };
  };
  const path = `M ${paddingX} ${baselineY} L ${paddingX + totalLength * scale} ${baselineY}`;
  const rangePath = (startM: number, endM: number) => {
    const start = positionAt(Math.min(startM, endM));
    const end = positionAt(Math.max(startM, endM));
    return `M ${start.x} ${baselineY} L ${end.x} ${baselineY}`;
  };

  return {
    width: Math.max(1000, totalLength * scale + paddingX * 2),
    routeHeight: 180,
    bends,
    path,
    positionAt,
    rangePath,
  };
}

export default function SectioningSchematic({
  features,
  sections,
  zoom,
  selectedGWs,
  onGwClick,
  onZoomChange,
  inspectedGw,
  onInspectGw,
  selectUnmatched = false,
  selectionEnabled = true,
}: SchematicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const geometry = useMemo(() => buildRouteGeometry(features, zoom), [features, zoom]);
  const historyStartY = geometry.routeHeight + 55;
  const totalHeight = historyStartY + Math.max(80, features.historicalLanes.length * 48 + 35);
  const markerStep = Math.max(100, Math.ceil(features.stats.totalLength / 10 / 100) * 100);

  return (
    <div className="sectioning-schematic flex h-full min-h-0 w-full flex-col bg-slate-50">
      <div className="relative min-h-0 flex-1 overflow-auto custom-scrollbar" ref={containerRef}>
        <div className="relative" style={{ width: geometry.width, height: totalHeight }}>
          <svg width={geometry.width} height={totalHeight} className="absolute inset-0" aria-label="Calculated master pipeline geometry">
            
            {/* KP Axis */}
            <g className="kp-axis" transform="translate(0, 40)">
              <text x="24" y="0" fontSize="11" fontWeight="bold" fill="#64748b">KP (km)</text>
              <line x1={geometry.positionAt(0).x} y1="15" x2={geometry.positionAt(features.stats.totalLength).x} y2="15" stroke="#cbd5e1" strokeWidth="1" />
              {Array.from({ length: Math.floor(features.stats.totalLength / markerStep) + 1 }).map((_, index) => {
                const distance = index * markerStep;
                const x = geometry.positionAt(distance).x;
                const isMajor = distance % 2000 === 0 || distance === 0;
                if (!isMajor && zoom < 1.5) return null; // hide minor ticks when zoomed out
                return (
                  <g key={`kp-${distance}`}>
                    <line x1={x} y1={isMajor ? 10 : 13} x2={x} y2="15" stroke="#94a3b8" strokeWidth="1" />
                    {isMajor && <text x={x} y="-2" textAnchor="middle" fontSize="10" fill="#64748b">{(distance / 1000).toFixed(0)} km</text>}
                  </g>
                );
              })}
            </g>

            {/* Sections (Blue Backgrounds) */}
            {sections.map((section) => {
              const startX = geometry.positionAt(section.startM).x;
              const endX = geometry.positionAt(section.endM).x;
              return (
                <g key={`section-path-${section.id}`}>
                  <rect
                    x={Math.min(startX, endX)}
                    y={60}
                    width={Math.abs(endX - startX)}
                    height={historyStartY - 60 + 40}
                    fill="#3b82f6"
                    fillOpacity="0.08"
                    stroke="#3b82f6"
                    strokeWidth="1"
                    strokeOpacity="0.5"
                  />
                  {/* Boundary Dots on Master */}
                  <circle cx={startX} cy={125} r="4" fill="#3b82f6" stroke="#fff" strokeWidth="1.5" />
                  <circle cx={endX} cy={125} r="4" fill="#3b82f6" stroke="#fff" strokeWidth="1.5" />
                  {/* Section Label */}
                  <text x={(startX + endX) / 2} y={55} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#1e3a8a">{section.name}</text>
                </g>
              );
            })}

            {/* Distance Measurement Tool */}
            {selectedGWs.length === 2 && (() => {
              const middleDist = (selectedGWs[0].dist + selectedGWs[1].dist) / 2;
              const middlePos = geometry.positionAt(middleDist);
              const distanceDiff = Math.abs(selectedGWs[1].dist - selectedGWs[0].dist);
              return (
                <g>
                  <path d={geometry.rangePath(selectedGWs[0].dist, selectedGWs[1].dist)} fill="none" stroke="#2563eb" strokeWidth="6" strokeOpacity="0.3" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x={middlePos.x - 40} y={middlePos.y - 32} width="80" height="22" rx="4" fill="#eff6ff" stroke="#3b82f6" strokeWidth="1.5" />
                  <text x={middlePos.x} y={middlePos.y - 17} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#1d4ed8">{distanceDiff.toFixed(3)} m</text>
                </g>
              );
            })()}

            {/* Master Pipeline Base Line */}
            <path d={geometry.path} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <text x="24" y={114} fontSize="12" fontWeight="bold" fill="#15803d">MASTER NEW</text>
            <text x="24" y={129} fontSize="11" fill="#166534">- longitudinal GW line</text>

            {/* Bends (Floating Boxes) */}
            {geometry.bends.map((bend, index) => (
              <g key={`bend-${bend.feature.id}-${index}`}>
                <rect x={bend.point.x - 42} y={bend.point.y - 70} width="84" height="32" rx="4" fill="#fff7ed" stroke="#f59e0b" strokeWidth="1" />
                <text x={bend.point.x} y={bend.point.y - 56} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#b45309">BEND {String(index + 1).padStart(2, '0')}</text>
                <text x={bend.point.x} y={bend.point.y - 45} textAnchor="middle" fontSize="9" fill="#b45309">{(bend.feature.dist / 1000).toFixed(2)} km / {bend.angleDeg.toFixed(0)}°</text>
                <line x1={bend.point.x} y1={bend.point.y - 38} x2={bend.point.x} y2={bend.point.y - 12} stroke="#f59e0b" strokeWidth="1" />
                <path d={`M ${bend.point.x} ${bend.point.y - 12} l 4 4 l -4 4 l -4 -4 z`} fill="#f59e0b" />
                <title>{`Bend ${index + 1} · ${bend.feature.dist.toFixed(3)} m · ${bend.angleDeg.toFixed(0)}°${bend.inferred ? ' · inferred' : ''}`}</title>
              </g>
            ))}

            {/* Master Features (GWs, Valves, etc) */}
            {features.allFeatures.map((feature, index) => {
              if (feature.type.toLowerCase().includes('bend')) return null;
              const position = geometry.positionAt(feature.dist);
              const isGw = /weld|girth|seam|gw/.test(feature.type.toLowerCase());
              const isValve = feature.type.toLowerCase().includes('valve') || feature.type.toLowerCase().includes('tee');
              const isUnmatched = isGw && feature.status !== 'MATCHED';
              const isSelected = selectedGWs.some((gw) => gw.id === feature.id && Math.abs(gw.dist - feature.dist) < 0.001);
              
              // Hide clutter at low zoom, but always show anomalies/selections
              if (isGw && !isUnmatched && !isSelected && !isValve && zoom < 1.5) {
                // Return a very thin tick to form a continuous line without looking bulky
                return <line key={`${feature.id}-${index}`} x1={position.x} y1={position.y - 5} x2={position.x} y2={position.y + 5} stroke="#22c55e" strokeWidth="1.5" strokeOpacity="0.7" />;
              }
              
              const color = isSelected ? '#2563eb' : isUnmatched ? '#ef4444' : isValve ? '#8b5cf6' : '#22c55e';
              const strokeW = isSelected || isUnmatched || isValve ? 4 : 2;
              const halfLen = isSelected || isUnmatched || isValve ? 9 : 6;
              
              return (
                <g
                  key={`${feature.id}-${index}`}
                  role={isGw ? 'button' : undefined}
                  tabIndex={isGw ? 0 : undefined}
                  className={isGw ? 'cursor-pointer outline-none' : ''}
                  onClick={() => {
                    if (!isGw) return;
                    onInspectGw?.(feature);
                    if (selectionEnabled) onGwClick(feature);
                  }}
                >
                  <title>{`${feature.type} · ${feature.id} · abs ${feature.dist.toFixed(3)} m · ${isUnmatched ? 'ONLY NEW / unmatched' : feature.status}`}</title>
                  <line x1={position.x} y1={position.y - halfLen} x2={position.x} y2={position.y + halfLen} stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
                  {isGw && <rect x={position.x - 14} y={position.y - 14} width="28" height="28" fill="transparent" pointerEvents="all" />}
                </g>
              );
            })}

            {/* Pair Links (Dashed connectors) */}
            {features.historicalLanes.flatMap((lane, laneIndex) => lane.gws.map((gw, gwIndex) => {
              const masterDistance = Number(gw.rawData.masterDistance);
              if (gw.status !== 'MATCHED' || !Number.isFinite(masterDistance)) return null;
              const master = geometry.positionAt(masterDistance);
              const historical = geometry.positionAt(gw.dist);
              const historicalY = historyStartY + laneIndex * 48;
              return (
                <line
                  key={`connector-${lane.id}-${gw.id}-${gwIndex}`}
                  x1={master.x}
                  y1={master.y + 10}
                  x2={historical.x}
                  y2={historicalY - 10}
                  stroke="#22c55e"
                  strokeWidth="1"
                  strokeOpacity="0.4"
                  strokeDasharray="4 4"
                >
                  <title>{`${gw.id} (${gw.dist.toFixed(3)} m) matched to ${gw.rawData.matchedMasterId} (${masterDistance.toFixed(3)} m)`}</title>
                </line>
              );
            }))}

            {/* Historical Lanes */}
            {features.historicalLanes.map((lane, laneIndex) => {
              const y = historyStartY + laneIndex * 48;
              return (
                <g key={lane.id}>
                  <text x="24" y={y + 4} fontSize="12" fontWeight="bold" fill="#475569">OLD {lane.year || laneIndex + 1}</text>
                  <line x1={geometry.positionAt(0).x} y1={y} x2={geometry.positionAt(features.stats.totalLength).x} y2={y} stroke="#64748b" strokeOpacity=".3" strokeWidth="2" />
                  
                  {/* Historical GWs */}
                  {(lane.gws || []).map((gw, gwIndex) => {
                    const x = geometry.positionAt(gw.dist).x;
                    const unmatched = gw.status !== 'MATCHED';
                    const isSelected = selectedGWs.some((s) => s.id === gw.id && s.runRole === 'HISTORICAL');
                    
                    if (!unmatched && !isSelected && zoom < 1.5) {
                      return <line key={`${gw.id}-${gwIndex}`} x1={x} y1={y - 5} x2={x} y2={y + 5} stroke="#22c55e" strokeWidth="1.5" strokeOpacity="0.7" />;
                    }

                    const color = unmatched ? '#ef4444' : isSelected ? '#2563eb' : '#22c55e';
                    const strokeW = unmatched || isSelected ? 4 : 2;
                    const halfLen = unmatched || isSelected ? 9 : 6;
                    
                    return (
                      <g
                        key={`${gw.id}-${gwIndex}`}
                        role="button"
                        className="cursor-pointer outline-none"
                        onClick={() => {
                          onInspectGw?.(gw);
                          if (selectionEnabled) onGwClick(gw);
                        }}
                      >
                        <line x1={x} y1={y - halfLen} x2={x} y2={y + halfLen} stroke={color} strokeWidth={strokeW} strokeLinecap="round">
                          <title>{`${gw.id} · abs ${gw.dist.toFixed(3)} m · ${gw.status}`}</title>
                        </line>
                        <rect x={x - 16} y={y - 16} width="32" height="32" fill="transparent" pointerEvents="all" />
                      </g>
                    );
                  })}
                </g>
              );
            })}

          </svg>
          
          {/* Legend */}
          <div className="absolute bottom-6 left-6 flex gap-4 items-center text-xs font-medium text-gray-700 bg-white/90 px-5 py-3 rounded-xl border border-gray-200 shadow-md backdrop-blur-sm">
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#22c55e] rounded-[2px]" />Matched</span>
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#ef4444] rounded-[2px]" />Missing</span>
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#eab308] rounded-[2px]" />Review</span>
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#8b5cf6] rounded-full" />Valve/Tee</span>
            <span className="flex items-center gap-2"><div className="w-5 h-0 border-t-[1.5px] border-dashed border-[#22c55e]" />Pair link</span>
          </div>
        </div>
      </div>
      <WeldTable features={features} />
    </div>
  );
}
