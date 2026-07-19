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
                  y1={master.y + 9}
                  x2={historical.x}
                  y2={historicalY - 7}
                  stroke="#00c853"
                  strokeWidth="1.5"
                  strokeOpacity="0.45"
                  strokeDasharray="4 4"
                >
                  <title>{`${gw.id} (${gw.dist.toFixed(3)} m) matched to ${gw.rawData.matchedMasterId} (${masterDistance.toFixed(3)} m)`}</title>
                </line>
              );
            }))}

            {sections.map((section) => (
              <path
                key={`section-path-${section.id}`}
                d={geometry.rangePath(section.startM, section.endM)}
                fill="none"
                stroke={sectionColor(section.type)}
                strokeWidth="18"
                strokeOpacity="0.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {selectedGWs.length === 2 && (() => {
              const middleDist = (selectedGWs[0].dist + selectedGWs[1].dist) / 2;
              const middlePos = geometry.positionAt(middleDist);
              const distanceDiff = Math.abs(selectedGWs[1].dist - selectedGWs[0].dist);
              return (
                <g>
                  <path d={geometry.rangePath(selectedGWs[0].dist, selectedGWs[1].dist)} fill="none" stroke="#2563eb" strokeWidth="25" strokeOpacity="0.22" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x={middlePos.x - 40} y={middlePos.y - 32} width="80" height="22" rx="4" fill="#eff6ff" stroke="#3b82f6" strokeWidth="1.5" />
                  <text x={middlePos.x} y={middlePos.y - 17} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#1d4ed8">{distanceDiff.toFixed(3)} m</text>
                </g>
              );
            })()}

            <path d={geometry.path} fill="none" stroke="#00c853" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {Array.from({ length: Math.floor(features.stats.totalLength / markerStep) + 1 }).map((_, index) => {
              const distance = index * markerStep;
              const position = geometry.positionAt(distance);
              const normal = { x: -position.unit.y, y: position.unit.x };
              return (
                <g key={`distance-${distance}`}>
                  <line x1={position.x - normal.x * 7} y1={position.y - normal.y * 7} x2={position.x + normal.x * 7} y2={position.y + normal.y * 7} stroke="#64748b" strokeWidth="1" />
                  <text x={position.x + normal.x * 18} y={position.y + normal.y * 18} textAnchor="middle" fontSize="9" fill="#64748b">{distance} m</text>
                </g>
              );
            })}

            {geometry.bends.map((bend, index) => (
              <g key={`bend-${bend.feature.id}-${index}`} className="sectioning-bend-marker">
                <line x1={bend.point.x} y1={bend.point.y - 7} x2={bend.point.x} y2={bend.point.y - 34} stroke="#d97706" strokeWidth="2" strokeDasharray="3 2" />
                <rect x={bend.point.x - 31} y={bend.point.y - 64} width="62" height="25" rx="4" fill="#fff7ed" stroke="#f59e0b" strokeWidth="1.5" />
                <path d={`M ${bend.point.x - 6} ${bend.point.y - 39} L ${bend.point.x} ${bend.point.y - 33} L ${bend.point.x + 6} ${bend.point.y - 39}`} fill="#fff7ed" stroke="#f59e0b" strokeWidth="1.5" />
                <path d={`M ${bend.point.x} ${bend.point.y - 30} l 7 7 l -7 7 l -7 -7 z`} fill="#f59e0b" stroke="#fff" strokeWidth="2" />
                <text x={bend.point.x} y={bend.point.y - 53} textAnchor="middle" fontSize="8" fontWeight="700" fill="#9a3412">BEND {String(index + 1).padStart(2, '0')}</text>
                <text x={bend.point.x} y={bend.point.y - 44} textAnchor="middle" fontSize="7" fill="#c2410c">{bend.feature.dist.toFixed(3)} m / {bend.angleDeg.toFixed(0)} deg</text>
                <title>{`Bend ${index + 1} · ${bend.feature.dist.toFixed(3)} m · ${bend.angleDeg.toFixed(0)}°${bend.inferred ? ' · inferred' : ''}`}</title>
              </g>
            ))}

            {features.allFeatures.map((feature, index) => {
              if (feature.type.toLowerCase().includes('bend')) return null;
              const color = featureColor(feature.type);
              if (color === 'transparent') return null;
              const position = geometry.positionAt(feature.dist);
              const normal = { x: -position.unit.y, y: position.unit.x };
              const isGw = /weld|girth|seam|gw/.test(feature.type.toLowerCase());
              const isUnmatched = isGw && feature.status !== 'MATCHED';
              const isSelectable = isGw && selectionEnabled;
              const isSelected = selectedGWs.some((gw) => gw.id === feature.id && Math.abs(gw.dist - feature.dist) < 0.001);
              const halfLength = isSelected ? 12 : isGw ? 7 : 5;
              const wallLabel = isGw ? formatWallThickness(feature) : null;
              const thicknessChange = isGw && wallLabel && isThicknessChange(feature, features.allFeatures[index - 1], features.allFeatures[index + 1]);
              return (
                <g
                  key={`${feature.id}-${index}`}
                  role={isGw ? 'button' : undefined}
                  tabIndex={isGw ? 0 : undefined}
                  className={isGw ? 'cursor-pointer outline-none' : ''}
                  onClick={() => {
                    if (!isGw) return;
                    onInspectGw?.(feature);
                    if (isSelectable) onGwClick(feature);
                  }}
                  onKeyDown={(event) => {
                    if (!isGw || (event.key !== 'Enter' && event.key !== ' ')) return;
                    onInspectGw?.(feature);
                    if (isSelectable) onGwClick(feature);
                  }}
                >
                  <title>{`${feature.type} · ${feature.id} · abs ${feature.dist.toFixed(3)} m · ${isUnmatched ? 'ONLY NEW / unmatched' : feature.status}`}</title>
                  <line
                    x1={position.x - normal.x * halfLength}
                    y1={position.y - normal.y * halfLength}
                    x2={position.x + normal.x * halfLength}
                    y2={position.y + normal.y * halfLength}
                    stroke={isSelected ? '#2563eb' : isUnmatched ? '#e11d48' : color}
                    strokeWidth={isSelected ? 5 : isUnmatched ? 5 : isGw ? 4 : 3}
                    strokeLinecap="round"
                  />
                  {isGw && (
                    <rect
                      x={position.x - 14}
                      y={position.y - 14}
                      width="28"
                      height="28"
                      fill="transparent"
                      pointerEvents="all"
                    />
                  )}
                  {thicknessChange && (
                    <g pointerEvents="none">
                      <rect x={position.x - 36} y={position.y - 58} width="72" height="18" rx="4" fill="#fff7ed" stroke="#fdba74" strokeWidth="1" />
                      <text x={position.x} y={position.y - 45} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#b45309">WT {wallLabel}</text>
                    </g>
                  )}
                  {isGw && <circle cx={position.x} cy={position.y} r="8" fill="transparent" />}
                </g>
              );
            })}

            {sections.map((section) => {
              const middle = geometry.positionAt((section.startM + section.endM) / 2);
              return <text key={`section-label-${section.id}`} x={middle.x} y={middle.y - 15} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">{section.name}</text>;
            })}

            <text x="24" y={historyStartY - 28} fontSize="10" fontWeight="700" fill="#00a844">MASTER NEW · longitudinal GW line</text>
            {features.historicalLanes.map((lane, laneIndex) => {
              const y = historyStartY + laneIndex * 48;
              return (
                <g key={lane.id}>
                  <text x="24" y={y + 3} fontSize="10" fontWeight="700" fill="#475569">OLD {lane.year || laneIndex + 1}</text>
                  <line x1={geometry.positionAt(0).x} y1={y} x2={geometry.positionAt(features.stats.totalLength).x} y2={y} stroke="#00c853" strokeOpacity=".35" strokeWidth="1.5" />
                  {(lane.bends || []).map((bend, bendIndex) => {
                    const x = geometry.positionAt(bend.dist).x;
                    const angle = bendDefinition(bend).angleDeg;
                    return (
                      <g key={`${lane.id}-bend-${bend.id}-${bendIndex}`}>
                        <line x1={x} y1={y - 2} x2={x} y2={y - 15} stroke="#d97706" strokeWidth="1.5" strokeDasharray="2 2" />
                        <path d={`M ${x} ${y - 23} l 5 5 l -5 5 l -5 -5 z`} fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
                        <text x={x + 8} y={y - 17} fontSize="7" fontWeight="700" fill="#c2410c">B{bendIndex + 1} / {angle.toFixed(0)} deg</text>
                        <title>{`OLD ${lane.year || laneIndex + 1} bend ${bendIndex + 1} · ${bend.dist.toFixed(3)} m · ${angle.toFixed(0)}°`}</title>
                      </g>
                    );
                  })}
                  {(lane.gws || []).map((gw, gwIndex) => {
                    const x = geometry.positionAt(gw.dist).x;
                    const unmatched = gw.status !== 'MATCHED';
                    return (
                      <g
                        key={`${gw.id}-${gwIndex}`}
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer outline-none"
                        onClick={() => {
                          onInspectGw?.(gw);
                          if (selectionEnabled) onGwClick(gw);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          onInspectGw?.(gw);
                          if (selectionEnabled) onGwClick(gw);
                        }}
                      >
                        <line x1={x} y1={y - (unmatched ? 8 : 4)} x2={x} y2={y + (unmatched ? 8 : 4)} stroke={unmatched ? '#ff1744' : '#00c853'} strokeWidth={unmatched ? 5 : 3} strokeLinecap="round">
                          <title>{`${gw.id} · abs ${gw.dist.toFixed(3)} m · ${gw.status}`}</title>
                        </line>
                        <rect
                          x={x - 16}
                          y={y - 16}
                          width="32"
                          height="32"
                          fill="transparent"
                          pointerEvents="all"
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Keep selection targets above every visual layer, including overlapping red markers. */}
            <g aria-label="GW selection targets">
              {features.allFeatures.filter((feature) => /weld|girth|seam|gw/i.test(feature.type)).map((feature, index) => {
                const position = geometry.positionAt(feature.dist);
                return (
                  <rect
                    key={`master-gw-hit-${feature.id}-${index}`}
                    x={position.x - 18}
                    y={position.y - 18}
                    width="36"
                    height="36"
                    fill="transparent"
                    pointerEvents="all"
                    role="button"
                    tabIndex={0}
                    aria-label={`Pilih ${feature.id}`}
                    onClick={() => {
                      onInspectGw?.(feature);
                      if (selectionEnabled) onGwClick(feature);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      onInspectGw?.(feature);
                      if (selectionEnabled) onGwClick(feature);
                    }}
                  />
                );
              })}
              {features.historicalLanes.flatMap((lane, laneIndex) => (lane.gws || []).map((gw, gwIndex) => {
                const x = geometry.positionAt(gw.dist).x;
                const y = historyStartY + laneIndex * 48;
                return (
                  <rect
                    key={`historical-gw-hit-${gw.id}-${gwIndex}`}
                    x={x - 18}
                    y={y - 18}
                    width="36"
                    height="36"
                    fill="transparent"
                    pointerEvents="all"
                    role="button"
                    tabIndex={0}
                    aria-label={`Pilih ${gw.id}`}
                    onClick={() => {
                      onInspectGw?.(gw);
                      if (selectionEnabled) onGwClick(gw);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      onInspectGw?.(gw);
                      if (selectionEnabled) onGwClick(gw);
                    }}
                  />
                );
              }))}
            </g>
          </svg>
          <div className="sectioning-legend" aria-label="GW status legend">
            <span><i className="sectioning-legend__dot sectioning-legend__dot--matched" />Matched</span>
            <span><i className="sectioning-legend__dot sectioning-legend__dot--missing" />Missing</span>
            <span><i className="sectioning-legend__dot sectioning-legend__dot--review" />Review</span>
            <span><i className="sectioning-legend__dot sectioning-legend__dot--valve" />Valve/Tee</span>
            <span><i className="sectioning-legend__line" />Pair link</span>
          </div>
        </div>
      </div>
      <WeldTable features={features} />
    </div>
  );
}
