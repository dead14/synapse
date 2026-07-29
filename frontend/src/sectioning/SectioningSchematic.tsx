import React, { useEffect, useMemo, useRef } from 'react';
import type { SectionDef, SpatialFeatures, SpatialFeature } from './types';
import { longitudinalAxisExtent } from './historicalLanes';
import { canInspectGwPrecisely, clampSchematicZoom, shouldShowUnmatchedMarkerLabel } from './viewOptions';
import { sectionColor } from './sectionColors';
import { bendDefinition } from './bendGeometry';
import WeldTable from './WeldTable';
import { getOriginalLd } from './gwPosition';

interface SchematicProps {
  features: SpatialFeatures;
  sections: SectionDef[];
  zoom: number;
  selectedGWs: SpatialFeature[];
  onGwClick: (gw: SpatialFeature) => void;
  onZoomChange: (zoom: number) => void;
  inspectedGw?: SpatialFeature | null;
  onInspectGw?: (gw: SpatialFeature | null) => void;
  selectionEnabled?: boolean;
  unmatchedSelectionEnabled?: boolean;
  selectedRange?: { startM: number; endM: number } | null;
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
  axisStart: number;
  axisEnd: number;
  bends: BendGeometry[];
  path: string;
  positionAt: (distance: number) => Point & { unit: Point };
  rangePath: (startM: number, endM: number) => string;
}

function buildRouteGeometry(features: SpatialFeatures, zoom: number): RouteGeometry {
  const totalLength = Math.max(features.stats.totalLength, 1);
  const extent = longitudinalAxisExtent(totalLength, features.historicalLanes);
  const axisLength = Math.max(extent.end - extent.start, 1);
  const scale = Math.max(0.08, 0.32 * zoom);
  const paddingX = 90;
  const baselineY = 125;
  const bendFeatures = features.allFeatures
    .filter((feature) => feature.type.toLowerCase().includes('bend'))
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
    const clamped = Math.max(extent.start, Math.min(extent.end, distance));
    return {
      x: paddingX + (clamped - extent.start) * scale,
      y: baselineY,
      unit: { x: 1, y: 0 },
    };
  };
  const path = `M ${positionAt(0).x} ${baselineY} L ${positionAt(totalLength).x} ${baselineY}`;
  const rangePath = (startM: number, endM: number) => {
    const start = positionAt(Math.min(startM, endM));
    const end = positionAt(Math.max(startM, endM));
    return `M ${start.x} ${baselineY} L ${end.x} ${baselineY}`;
  };

  return {
    width: Math.max(1000, axisLength * scale + paddingX * 2),
    routeHeight: 180,
    axisStart: extent.start,
    axisEnd: extent.end,
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
  selectionEnabled = true,
  unmatchedSelectionEnabled = false,
  selectedRange = null,
}: SchematicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const geometry = useMemo(() => buildRouteGeometry(features, zoom), [features, zoom]);
  const historyStartY = geometry.routeHeight + 55;
  const totalHeight = historyStartY + Math.max(80, features.historicalLanes.length * 48 + 35);
  const axisLength = geometry.axisEnd - geometry.axisStart;
  const markerStep = Math.max(100, Math.ceil(axisLength / 10 / 100) * 100);
  const firstMarker = Math.ceil(geometry.axisStart / markerStep) * markerStep;
  const markerCount = Math.floor((geometry.axisEnd - firstMarker) / markerStep) + 1;
  const showUnmatchedLabels = shouldShowUnmatchedMarkerLabel(zoom);
  const canInspectGws = canInspectGwPrecisely(zoom);

  // Selecting a girth weld needs zoom 6+, which is tedious to reach from the
  // toolbar alone, so ctrl/cmd + wheel zooms around the pointer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const anchorRatio = (container.scrollLeft + event.offsetX) / Math.max(1, container.scrollWidth);
      const next = clampSchematicZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
      if (next === zoom) return;
      onZoomChange(next);
      requestAnimationFrame(() => {
        container.scrollLeft = anchorRatio * container.scrollWidth - event.clientX + container.getBoundingClientRect().left;
      });
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [onZoomChange, zoom]);

  const activateGw = (gw: SpatialFeature) => {
    if (!canInspectGws) return;
    onInspectGw?.(gw);
    if (selectionEnabled && (gw.status === 'MATCHED' || unmatchedSelectionEnabled)) onGwClick(gw);
  };
  const markerKeyDown = (gw: SpatialFeature) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateGw(gw);
  };

  return (
    <div className="sectioning-schematic flex h-full min-h-0 w-full flex-col bg-slate-50">
      <div className="relative min-h-0 flex-1 overflow-auto custom-scrollbar" ref={containerRef}>
        <div className="relative" style={{ width: geometry.width, height: totalHeight }}>
          <svg width={geometry.width} height={totalHeight} className="absolute inset-0" aria-label="Calculated master pipeline geometry">
            
            {/* KP Axis */}
            <g className="kp-axis" transform="translate(0, 40)">
              <text x="24" y="0" fontSize="11" fontWeight="bold" fill="#64748b">KP (km)</text>
              <line x1={geometry.positionAt(geometry.axisStart).x} y1="15" x2={geometry.positionAt(geometry.axisEnd).x} y2="15" stroke="#cbd5e1" strokeWidth="1" />
              {Array.from({ length: markerCount }).map((_, index) => {
                const distance = firstMarker + index * markerStep;
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
              const color = sectionColor(section.type);
              return (
                <g key={`section-path-${section.id}`}>
                  <rect
                    x={Math.min(startX, endX)}
                    y={60}
                    width={Math.abs(endX - startX)}
                    height={historyStartY - 60 + 40}
                    fill={color}
                    fillOpacity="0.12"
                    stroke={color}
                    strokeWidth="1"
                    strokeOpacity="0.6"
                  />
                  {/* Boundary Dots on Master */}
                  <circle cx={startX} cy={125} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
                  <circle cx={endX} cy={125} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
                  {/* Section Label */}
                  <text x={(startX + endX) / 2} y={55} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#1e293b">{section.name}</text>
                </g>
              );
            })}

            {/* Distance Measurement Tool */}
            {selectedGWs.length === 2 && selectedRange && (() => {
              const middleDist = (selectedRange.startM + selectedRange.endM) / 2;
              const middlePos = geometry.positionAt(middleDist);
              const distanceDiff = Math.abs(selectedRange.endM - selectedRange.startM);
              return (
                <g>
                  <path d={geometry.rangePath(selectedRange.startM, selectedRange.endM)} fill="none" stroke="#2563eb" strokeWidth="6" strokeOpacity="0.3" strokeLinecap="round" strokeLinejoin="round" />
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
              const isInspected = Boolean(inspectedGw && inspectedGw.id === feature.id && inspectedGw.runRole === feature.runRole);

              const color = isSelected ? '#2563eb' : isUnmatched ? '#ef4444' : isValve ? '#8b5cf6' : '#10b981';
              const isAnomaly = isSelected || isUnmatched || isValve;
              const boxW = isAnomaly ? 6 : 4;
              const boxH = isAnomaly ? 18 : 14;
              const rx = boxW / 2;
              
              return (
                <g
                  key={`${feature.id}-${index}`}
                  role={isGw && canInspectGws ? 'button' : undefined}
                  tabIndex={isGw && canInspectGws ? 0 : undefined}
                  aria-label={isGw && canInspectGws ? `GW ${feature.id} at ${feature.dist.toFixed(3)} m, ${isUnmatched ? 'no OLD pair' : 'paired'}` : undefined}
                  className={isGw && canInspectGws ? 'cursor-pointer' : ''}
                  onClick={() => { if (isGw) activateGw(feature); }}
                  onKeyDown={isGw && canInspectGws ? markerKeyDown(feature) : undefined}
                >
                  <title>{`${feature.type} · ${feature.id} · abs ${feature.dist.toFixed(3)} m${getOriginalLd(feature.rawData) ? ` · Orig LD: ${getOriginalLd(feature.rawData)}` : ''} · ${isUnmatched ? 'No OLD pair' : feature.status}`}</title>
                  {isInspected && (
                    <rect x={position.x - boxW / 2 - 3} y={position.y - boxH / 2 - 3} width={boxW + 6} height={boxH + 6} rx={rx + 3} fill="none" stroke="#1d4ed8" strokeWidth="1.5" />
                  )}
                  <rect x={position.x - boxW / 2} y={position.y - boxH / 2} width={boxW} height={boxH} rx={rx} fill={color} />
                  
                  {isUnmatched && showUnmatchedLabels && (
                    <g pointerEvents="none">
                      <rect x={position.x - 48} y={position.y - 28} width="96" height="14" rx="7" fill="#fff" stroke={color} strokeWidth="1" strokeOpacity="0.7" />
                      <text x={position.x} y={position.y - 18} textAnchor="middle" fontSize="8" fill={color} fontWeight="bold">NO OLD PAIR · {feature.dist.toFixed(1)} m</text>
                    </g>
                  )}
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
                  stroke="#10b981"
                  strokeWidth="1"
                  strokeOpacity="0.4"
                  strokeDasharray="3 3"
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
                  <line x1={geometry.positionAt(geometry.axisStart).x} y1={y} x2={geometry.positionAt(geometry.axisEnd).x} y2={y} stroke="#64748b" strokeOpacity=".3" strokeWidth="2" />
                  
                  {/* Historical GWs */}
                  {(lane.gws || []).map((gw, gwIndex) => {
                    const x = geometry.positionAt(gw.dist).x;
                    const unmatched = gw.status !== 'MATCHED';
                    const isSelected = selectedGWs.some((s) => s.id === gw.id && s.runRole === 'HISTORICAL');
                    
                    const color = unmatched ? '#ef4444' : isSelected ? '#2563eb' : '#10b981';
                    const isAnomaly = isSelected || unmatched;
                    const boxW = isAnomaly ? 6 : 4;
                    const boxH = isAnomaly ? 18 : 14;
                    const rx = boxW / 2;
                    
                    return (
                      <g
                        key={`${gw.id}-${gwIndex}`}
                        role={canInspectGws ? 'button' : undefined}
                        tabIndex={canInspectGws ? 0 : undefined}
                        aria-label={canInspectGws ? `OLD GW ${gw.id} at ${gw.dist.toFixed(3)} m, ${unmatched ? 'no NEW pair' : 'paired'}` : undefined}
                        className={canInspectGws ? 'cursor-pointer' : ''}
                        onClick={() => activateGw(gw)}
                        onKeyDown={canInspectGws ? markerKeyDown(gw) : undefined}
                      >
                        <rect x={x - boxW / 2} y={y - boxH / 2} width={boxW} height={boxH} rx={rx} fill={color} />
                        <title>{`${gw.id} · abs ${gw.dist.toFixed(3)} m${getOriginalLd(gw.rawData) ? ` · Orig LD: ${getOriginalLd(gw.rawData)}` : ''} · ${gw.status}`}</title>
                        
                        {unmatched && showUnmatchedLabels && (
                          <g pointerEvents="none">
                            <rect x={x - 48} y={y + 14} width="96" height="14" rx="7" fill="#fff" stroke={color} strokeWidth="1" strokeOpacity="0.7" />
                            <text x={x} y={y + 24} textAnchor="middle" fontSize="8" fill={color} fontWeight="bold">NO NEW PAIR · {gw.dist.toFixed(1)} m</text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

          </svg>
          
          {/* Legend */}
          <div className="absolute bottom-6 left-6 flex gap-4 items-center text-xs font-medium text-gray-700 bg-white/90 px-5 py-3 rounded-xl border border-gray-200 shadow-md backdrop-blur-sm">
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#10b981] rounded-[2px]" />Matched</span>
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#ef4444] rounded-[2px]" />Unpaired</span>
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#2563eb] rounded-[2px]" />Selected</span>
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#8b5cf6] rounded-[2px]" />Valve/Tee</span>
            <span className="flex items-center gap-2"><div className="w-3 h-3 bg-[#f59e0b] rounded-[2px]" />Bend</span>
            <span className="flex items-center gap-2"><div className="w-5 h-0 border-t-[1.5px] border-dashed border-[#10b981]" />Pair link</span>
          </div>
        </div>
      </div>
      <WeldTable features={features} />
    </div>
  );
}
