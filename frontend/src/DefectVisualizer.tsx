import React from 'react';
import { useState, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { FiBox, FiX } from 'react-icons/fi';
import Modal from './components/common/Modal';
import LaneTimeline, { type SpoolRange } from './components/comparison/LaneTimeline';
import { apiFetch } from './utils/api';
import { clampTooltipPosition } from './utils/tooltipPosition';
import { parseClockToDegrees } from './utils/clock';
import {
  buildComparisonLanes,
  type ComparisonLane,
  type LaneFeature,
} from './domain/comparisonLanes.ts';

interface DefectVisualizerProps {
  data: any[];
  selectedRowIdx?: number | null;
  onSelectRowIdx?: (idx: number | null) => void;
}

const MAX_SPOOL_FEATURES = 2_000;

function isExternalSurface(value: unknown): boolean {
  return String(value ?? '').toUpperCase().includes('EXT');
}

function svgActionKeyDown(action: (clientX: number, clientY: number) => void) {
  return (event: React.KeyboardEvent<SVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    action(box.left + box.width / 2, box.top + box.height / 2);
  };
}

function sampleEvenly<T>(items: T[], limit: number, keep?: (item: T) => boolean): T[] {
  if (items.length <= limit) return items;
  const selected = keep ? items.filter(keep) : [];
  const available = Math.max(1, limit - selected.length);
  const step = Math.max(1, Math.ceil(items.length / available));
  const sampled = items.filter((_item, index) => index % step === 0);
  return Array.from(new Set([...sampled, ...selected])).slice(0, limit);
}

function nearestDistance(sortedDistances: number[], value: number): number {
  let low = 0;
  let high = sortedDistances.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedDistances[middle] < value) low = middle + 1;
    else high = middle;
  }
  return Math.min(
    Math.abs((sortedDistances[low] ?? Infinity) - value),
    Math.abs((sortedDistances[low - 1] ?? Infinity) - value),
  );
}

const STATUS_BADGE: Record<string, string> = {
  persistent: 'Carried over',
  new: 'New',
  lost: 'Gone next run',
  transient: 'One run only',
  single: 'Single run',
};

// ─── 3D viewer sub-components (unchanged) ─────────────────────────────

const FEAPipeMesh = ({ renderLength, sLength, startDist, spoolData, gwList }: { renderLength: number, sLength: number, startDist: number, spoolData: any[], gwList: number[] }) => {
  const defectBuckets = useMemo(() => {
    const buckets = new Map<number, any[]>();
    const add = (distance: number | null, defect: any) => {
      if (distance === null || !Number.isFinite(distance)) return;
      const key = Math.floor(distance);
      const list = buckets.get(key) || [];
      list.push({ defect, distance });
      buckets.set(key, list);
    };
    spoolData.forEach((defect) => {
      add(defect.dist1, defect);
      add(defect.dist2, defect);
    });
    return buckets;
  }, [spoolData]);

  const geom = useMemo(() => {
    const segments = 64;
    const padding = 2.0;
    const actualPipeLength = renderLength + (padding * 2);
    const heightSegments = Math.min(400, Math.max(10, Math.ceil(actualPipeLength * 4)));
    const pipeRadius = 2.0;
    const geometry = new THREE.CylinderGeometry(pipeRadius, pipeRadius, actualPipeLength, segments, heightSegments, true);
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    const weldHalfWidth = 0.15;
    const weldBulgeHeight = 0.06;
    for (let i = 0; i < pos.count; i++) {
      let vx = pos.getX(i);
      const vy = pos.getY(i);
      let vz = pos.getZ(i);
      color.set('#38bdf8');
      const trueDist = ((vy + renderLength / 2) / renderLength) * sLength + startDist;
      let theta = Math.atan2(vx, vz);
      if (theta < 0) theta += 2 * Math.PI;
      const orientDeg = theta * (180 / Math.PI);
      const minGwDist = nearestDistance(gwList, trueDist);
      const weldHalfWidthVy = (weldHalfWidth / sLength) * renderLength;
      const minGwDistVy = (minGwDist / sLength) * renderLength;
      let isInWeld = false;
      if (minGwDistVy < weldHalfWidthVy) {
        isInWeld = true;
        const t = minGwDistVy / weldHalfWidthVy;
        const bulge = (Math.cos(t * Math.PI) + 1) * 0.5 * weldBulgeHeight;
        const currentR = Math.sqrt(vx * vx + vz * vz);
        if (currentR > 0) {
          const newR = currentR + bulge;
          vx = vx * (newR / currentR);
          vz = vz * (newR / currentR);
          pos.setX(i, vx);
          pos.setZ(i, vz);
        }
        const brightness = 0.35 + t * 0.15;
        color.setRGB(brightness, brightness, brightness + 0.05);
      }
      if (!isInWeld) {
        let maxDepth = 0;
        const nearbyDefects: any[] = [];
        const distanceBucket = Math.floor(trueDist);
        for (let bucket = distanceBucket - 1; bucket <= distanceBucket + 1; bucket += 1) {
          const candidates = defectBuckets.get(bucket);
          if (candidates) nearbyDefects.push(...candidates);
        }
        nearbyDefects.forEach(({ defect: d, distance: defectDistance }) => {
          const checkDefect = (dist: number, orient: number, len: number, wid: number, depth: number) => {
            const sLen = Math.max(0.4, len * 0.03);
            const sWidAngle = Math.max(15, wid * 1.5);
            const inDist = Math.abs(trueDist - dist) <= (sLen / 2);
            let angleDiff = Math.abs(orientDeg - orient);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            const inOrient = angleDiff <= (sWidAngle / 2);
            if (inDist && inOrient) maxDepth = Math.max(maxDepth, depth);
          };
          if (defectDistance === d.dist1) checkDefect(d.dist1, d.orient1, d.len1, d.wid1, d?.depth1);
          if (defectDistance === d.dist2) checkDefect(d.dist2, d.orient2, d.len2, d.wid2, d?.depth2);
        });
        if (maxDepth > 0) {
          if (maxDepth > 50) color.set('#991b1b');
          else if (maxDepth > 25) color.set('#ef4444');
          else if (maxDepth > 10) color.set('#f97316');
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
  }, [renderLength, sLength, startDist, defectBuckets, gwList]);

  const padding = 2.0;
  const clockRadius = 2.4;
  const capY = -(renderLength / 2) - padding;

  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh geometry={geom}>
        <meshStandardMaterial vertexColors={true} roughness={0.55} metalness={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geom} scale={[1.001, 1, 1.001]}>
        <meshBasicMaterial color="#0f172a" wireframe transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      <Text position={[0, capY, clockRadius]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">12:00</Text>
      <Text position={[clockRadius, capY, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">3:00</Text>
      <Text position={[0, capY, -clockRadius]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">6:00</Text>
      <Text position={[-clockRadius, capY, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.4} color="#f87171" anchorX="center" anchorY="middle">9:00</Text>
    </group>
  );
};

const DefectOverlayInstancedMesh = ({ spoolData, renderLength, sLength, startDist, onSelect }: any) => {
  const meshRef = React.useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const instances = useMemo(() => spoolData.flatMap((d: any) => [
    d.dist1 === null ? null : { d, dist: d.dist1, orient: d.orient1, len: d.len1, wid: d.wid1, id: d.id1 },
    d.dist2 === null ? null : { d, dist: d.dist2, orient: d.orient2, len: d.len2, wid: d.wid2, id: d.id2 },
  ]).filter(Boolean), [spoolData]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = instances.length;
    instances.forEach((instance: any, index: number) => {
      const angle = Number(instance.orient || 0) * (Math.PI / 180);
      const vy = ((Number(instance.dist) - startDist) / Math.max(sLength, 0.001)) * renderLength - renderLength / 2;
      dummy.position.set(Math.cos(angle) * 2.05, vy, Math.sin(angle) * 2.05);
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.set(Math.max(0.6, Number(instance.wid || 0) * 0.05), Math.max(0.6, Number(instance.len || 0) * 0.05), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy, instances, renderLength, sLength, startDist]);

  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, Math.max(1, instances.length)]}
        onPointerOver={(event: any) => { event.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={(event: any) => { event.stopPropagation(); document.body.style.cursor = 'default'; }}
        onClick={(event: any) => {
          event.stopPropagation();
          const instance = instances[event.instanceId ?? -1] as any;
          if (instance) onSelect(instance.id, instance.d, event);
        }}
      />
    </group>
  );
};

// ─── Main component ────────────────────────────────────────────────────

export default function DefectVisualizer({ data, selectedRowIdx, onSelectRowIdx }: DefectVisualizerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalViewMode, setModalViewMode] = useState<'2D' | '3D'>('3D');
  const [spoolRange, setSpoolRange] = useState<SpoolRange | null>(null);
  const [inspected, setInspected] = useState<{ feature: LaneFeature; lane: ComparisonLane } | null>(null);
  const [hoveredDefect, setHoveredDefect] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!isModalOpen || modalViewMode !== '3D') return undefined;
    const startedAt = performance.now();
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const durationMs = performance.now() - startedAt;
        apiFetch('/api/metrics/browser', {
          method: 'POST',
          body: { name: 'render_3d_viewer', durationMs: Math.round(durationMs * 100) / 100 },
        }).catch(() => {});
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [isModalOpen, modalViewMode, selectedRowIdx]);

  // One lane per inspection run: two runs give two lanes, a three-run chain
  // gives three, each holding the distances that run actually reported.
  const { lanes, unalignedRuns } = useMemo(() => buildComparisonLanes(data), [data]);

  // The 3D spool still draws both runs on one pipe body, so it keeps reading the
  // engine's master-axis distances rather than the per-run reported ones.
  const parsedData = useMemo(() => data.map((item, idx) => {
    if (!item) return null;
    const r1Dist = parseFloat(item['Log Dist OLD (m)']);
    const r2Dist = parseFloat(item['Log Dist NEW (m)']);
    return {
      id1: (item['Identif. OLD'] && item['Identif. OLD'] !== '-') ? String(item['Identif. OLD']) : null,
      dist1: Number.isNaN(r1Dist) ? null : r1Dist,
      len1: parseFloat(item['Length OLD (mm)']) || 10,
      wid1: parseFloat(item['Width OLD (mm)']) || 10,
      orient1: parseClockToDegrees(item["O'Clock OLD"]),
      depth1: parseFloat(item['Depth OLD (%WT)']) || 0,
      isExt1: isExternalSurface(item['Int/Ext OLD'] ?? item['Surface OLD']),
      id2: (item['Identif. NEW'] && item['Identif. NEW'] !== '-') ? String(item['Identif. NEW']) : null,
      dist2: Number.isNaN(r2Dist) ? null : r2Dist,
      len2: parseFloat(item['Length NEW (mm)']) || 10,
      wid2: parseFloat(item['Width NEW (mm)']) || 10,
      orient2: parseClockToDegrees(item["O'Clock NEW"]),
      depth2: parseFloat(item['Depth NEW (%WT)']) || 0,
      isExt2: isExternalSurface(item['Int/Ext NEW'] ?? item['Surface NEW']),
      isMatched: !Number.isNaN(r1Dist) && !Number.isNaN(r2Dist),
      rawItem: item,
      dataIdx: idx,
    };
  }).filter(Boolean), [data]);

  const masterGwList = useMemo(() => {
    const master = lanes.find((lane) => lane.isMaster);
    return (master?.gws ?? [])
      .map((gw) => gw.alignedM)
      .filter((distance): distance is number => distance !== null)
      .sort((left, right) => left - right);
  }, [lanes]);

  const openFeature = (
    feature: LaneFeature,
    lane: ComparisonLane,
    pointer: { clientX: number; clientY: number },
  ) => {
    setInspected({ feature, lane });
    setHoveredDefect(null);
    setTooltipPos({ x: pointer.clientX, y: pointer.clientY });
  };

  const closeTooltip = () => {
    setInspected(null);
    setHoveredDefect(null);
  };

  // ─── 3D modal content ───

  const renderModalContent = () => {
    if (!spoolRange) return null;
    const spoolData = parsedData.filter((defect: any) => {
      const distance = defect.dist1 !== null ? defect.dist1 : defect.dist2;
      return distance !== null && distance >= spoolRange.startM && distance <= spoolRange.endM;
    });
    const renderableSpoolData = sampleEvenly(spoolData, MAX_SPOOL_FEATURES, (item: any) => item.dataIdx === selectedRowIdx);
    const sLength = Math.max(0.01, spoolRange.endM - spoolRange.startM);
    const modalSvgWidth = 800;
    const sToX = (dist: number) => ((dist - spoolRange.startM) / sLength) * modalSvgWidth;

    if (modalViewMode === '2D') {
      const pipeHeight = 240;
      const oToY = (orient: number) => (orient / 360) * pipeHeight;
      return (
        <div className="w-full flex justify-center">
          <div style={{ width: modalSvgWidth, height: pipeHeight + 60 }} className="relative rounded-xl">
            <svg width="100%" height="100%">
              {[0, 90, 180, 270, 360].map((deg) => {
                const y = oToY(deg) + 30;
                let label = '12:00';
                if (deg === 90) label = '3:00';
                if (deg === 180) label = '6:00';
                if (deg === 270) label = '9:00';
                return (
                  <g key={`clock-${deg}`}>
                    <line x1="0" y1={y} x2="100%" y2={y} stroke="var(--syn-line, #e2e8f0)" strokeWidth="1" strokeDasharray="4 4" />
                    <text x="10" y={y - 5} fontSize="10" fill="var(--syn-muted, #94a3b8)" fontWeight="bold">{deg}° ({label})</text>
                  </g>
                );
              })}
              {renderableSpoolData.map((d: any, i: number) => {
                const scaleDim = (val: number) => Math.max(10, val * 0.8);
                if (d.isMatched && d.dist1 !== null && d.dist2 !== null) {
                  const cx1 = sToX(d.dist1); const cy1 = oToY(d.orient1) + 30;
                  const w1 = scaleDim(d.len1); const h1 = scaleDim(d.wid1);
                  const cx2 = sToX(d.dist2); const cy2 = oToY(d.orient2) + 30;
                  const w2 = scaleDim(d.len2); const h2 = scaleDim(d.wid2);
                  return (
                    <g key={`2d-m-${i}`} className="cursor-pointer" role="button" tabIndex={0}
                      aria-label={`Matched defect ${d.id1 ?? d.id2 ?? ''}`}
                      onClick={(e) => { e.stopPropagation(); setHoveredDefect(d); setInspected(null); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                      onKeyDown={svgActionKeyDown((cx, cy) => { setHoveredDefect(d); setInspected(null); setTooltipPos({ x: cx, y: cy }); })}
                    >
                      <line x1={cx1} y1={cy1} x2={cx2} y2={cy2} stroke="#fca5a5" strokeWidth="1" strokeDasharray="2 2" />
                      <ellipse cx={cx1} cy={cy1} rx={w1 / 2} ry={h1 / 2} fill={d.isExt1 ? 'rgba(148,163,184,0.4)' : 'transparent'} stroke="#94a3b8" strokeWidth={d.isExt1 ? '1' : '2'} strokeDasharray={d.isExt1 ? '0' : '2'} />
                      <ellipse cx={cx2} cy={cy2} rx={w2 / 2} ry={h2 / 2} fill={d.isExt2 ? 'rgba(239,68,68,0.6)' : 'transparent'} stroke="#ef4444" strokeWidth={d.isExt2 ? '1' : '2'} strokeDasharray={d.isExt2 ? '0' : '2'} />
                      {(d.len2 > d.len1 || d.wid2 > d.wid1) && (
                        <text x={cx2} y={cy2 - h2 / 2 - 5} fontSize="10" fill="#b91c1c" fontWeight="bold" textAnchor="middle">Growth!</text>
                      )}
                    </g>
                  );
                }
                const isRun1 = d.dist1 !== null;
                const cx = isRun1 ? sToX(d.dist1) : sToX(d.dist2);
                const cy = (isRun1 ? oToY(d.orient1) : oToY(d.orient2)) + 30;
                const w = scaleDim(isRun1 ? d.len1 : d.len2);
                const h = scaleDim(isRun1 ? d.wid1 : d.wid2);
                const isExt = isRun1 ? d.isExt1 : d.isExt2;
                const color = isRun1 ? '#3b82f6' : '#f59e0b';
                return (
                  <g key={`2d-u-${i}`} className="cursor-pointer" role="button" tabIndex={0}
                    aria-label={`Unmatched defect ${d.id1 ?? d.id2 ?? ''}`}
                    onClick={(e) => { e.stopPropagation(); setHoveredDefect(d); setInspected(null); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                    onKeyDown={svgActionKeyDown((cx2, cy2) => { setHoveredDefect(d); setInspected(null); setTooltipPos({ x: cx2, y: cy2 }); })}
                  >
                    <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={isExt ? color : 'transparent'} fillOpacity={0.6} stroke={color} strokeWidth={isExt ? '1' : '2'} strokeDasharray={isExt ? '0' : '2'} />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      );
    }

    const renderLength = Math.min(sLength, 200);
    return (
      <div className="w-full h-[400px] rounded-xl overflow-hidden relative" style={{ background: '#1e293b' }}>
        <div className="absolute top-4 left-4 z-10 text-white/70 text-xs">Left Click: Rotate | Right Click: Pan | Scroll: Zoom</div>
        <Canvas camera={{ position: [0, 0, Math.min(20, renderLength / 2)], fov: 45 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[10, 20, 10]} intensity={1.5} />
          <OrbitControls enableDamping dampingFactor={0.05} />
          <FEAPipeMesh renderLength={renderLength} sLength={sLength} startDist={spoolRange.startM} spoolData={renderableSpoolData} gwList={masterGwList} />
          <DefectOverlayInstancedMesh
            spoolData={renderableSpoolData} renderLength={renderLength} sLength={sLength} startDist={spoolRange.startM}
            onHover={() => {}}
            onSelect={(_id: string, d: any, e: any) => {
              setHoveredDefect(d);
              setInspected(null);
              if (e) setTooltipPos({ x: e.clientX, y: e.clientY });
            }}
          />
        </Canvas>
      </div>
    );
  };

  // ─── Tooltip rows ───

  const featureRows = (feature: LaneFeature, lane: ComparisonLane): Array<[string, string]> => {
    const rows: Array<[string, string]> = [
      ['Run', lane.label],
      ['Reported LD', feature.rawM === null ? '—' : `${feature.rawM.toFixed(3)} m`],
    ];
    if (!lane.isMaster) {
      rows.push(['On master axis', feature.alignedM === null ? 'not aligned' : `${feature.alignedM.toFixed(3)} m`]);
    }
    rows.push(
      ['Dist U/S GW', feature.usGwM === null ? '—' : `${feature.usGwM.toFixed(3)} m`],
      ['Joint no.', feature.jointNo ?? '—'],
      ['Clock', feature.clockLabel],
      ['Surface', feature.external === null ? '—' : (feature.external ? 'External' : 'Internal')],
      ['Depth', feature.depthPct === null ? '—' : `${feature.depthPct} %WT`],
      ['Length', feature.lengthMm === null ? '—' : `${feature.lengthMm} mm`],
      ['Width', feature.widthMm === null ? '—' : `${feature.widthMm} mm`],
      ['Type', feature.featureType || '—'],
    );
    return rows;
  };

  const legacyRows = (defect: any): Array<[string, string]> => ([
    ['Dist U/S GW', `${defect.rawItem?.['Dist GW OLD (m)'] || defect.rawItem?.['Dist GW NEW (m)'] || '-'} m`],
    ['Clock', `${defect.rawItem?.["O'Clock OLD"] || defect.rawItem?.["O'Clock NEW"] || '-'}`],
    ['Depth', `${defect.rawItem?.['Depth OLD (%WT)'] || defect.rawItem?.['Depth NEW (%WT)'] || '-'} %WT`],
    ['Length', `${defect.rawItem?.['Length OLD (mm)'] || defect.rawItem?.['Length NEW (mm)'] || '-'} mm`],
    ['Width', `${defect.rawItem?.['Width OLD (mm)'] || defect.rawItem?.['Width NEW (mm)'] || '-'} mm`],
  ]);

  const tooltipOpen = inspected !== null || hoveredDefect !== null;
  const tooltipTitle = inspected
    ? inspected.feature.id
    : (hoveredDefect?.id1 || hoveredDefect?.id2 || '—');
  const tooltipBadge = inspected
    ? { label: STATUS_BADGE[inspected.feature.status] ?? inspected.feature.status, good: inspected.feature.status === 'persistent' }
    : { label: hoveredDefect?.isMatched ? 'Matched' : 'Unmatched', good: Boolean(hoveredDefect?.isMatched) };
  const tooltipRows = inspected
    ? featureRows(inspected.feature, inspected.lane)
    : (hoveredDefect ? legacyRows(hoveredDefect) : []);
  const tooltipRowIdx = inspected ? inspected.feature.rowIndex : hoveredDefect?.dataIdx;

  // ─── Main render ───

  return (
    <div className="syn-panel flex flex-col overflow-hidden" style={{ padding: 0 }}>
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-2" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--syn-ink, #151711)', letterSpacing: '-0.02em' }}>
            Run comparison
          </h3>
          <span className="text-xs" style={{ color: 'var(--syn-muted, #727a6d)' }}>
            {lanes.length} inspection {lanes.length === 1 ? 'run' : 'runs'} · {data.length.toLocaleString()} comparison rows
          </span>
          <span className="text-xs" style={{ color: 'var(--syn-muted, #727a6d)' }}>
            Click two girth welds on one lane to open that spool in 3D
          </span>
        </div>
        <div className="flex items-center gap-2">
          {spoolRange && (
            <button onClick={() => setIsModalOpen(true)} className="syn-btn syn-btn--sm syn-btn--ink">
              <FiBox size={14} /> 3D View ({(spoolRange.endM - spoolRange.startM).toFixed(1)} m)
            </button>
          )}
        </div>
      </div>

      <LaneTimeline
        lanes={lanes}
        unalignedRuns={unalignedRuns}
        selectedRowIdx={selectedRowIdx}
        onFeatureClick={openFeature}
        onSpoolRangeChange={setSpoolRange}
      />

      {/* 3D Modal */}
      {isModalOpen && (
        <Modal
          onClose={() => setIsModalOpen(false)}
          labelledBy="spool-detail-title"
          overlayClassName="fixed inset-0 z-[999999] flex items-center justify-center p-8"
          panelClassName="w-full max-w-5xl overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
            <div>
              <h2 id="spool-detail-title" className="text-lg font-bold" style={{ color: 'var(--syn-ink, #151711)' }}>Spool Detail View</h2>
              <p className="text-sm" style={{ color: 'var(--syn-muted, #727a6d)' }}>
                Master axis {spoolRange?.startM.toFixed(2)} m to {spoolRange?.endM.toFixed(2)} m · picked on {spoolRange?.laneLabel}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex p-0.5 rounded-lg" style={{ background: 'var(--syn-canvas-strong, #dfe5dc)' }}>
                <button onClick={() => setModalViewMode('2D')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${modalViewMode === '2D' ? 'bg-white shadow-sm' : ''}`} style={modalViewMode === '2D' ? { color: 'var(--syn-info, #155eef)' } : { color: 'var(--syn-muted, #727a6d)' }}>2D Unrolled</button>
                <button onClick={() => setModalViewMode('3D')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${modalViewMode === '3D' ? 'bg-white shadow-sm' : ''}`} style={modalViewMode === '3D' ? { color: 'var(--syn-info, #155eef)' } : { color: 'var(--syn-muted, #727a6d)' }}>3D Pipe</button>
              </div>
              <button onClick={() => setIsModalOpen(false)} aria-label="Close spool detail view" className="p-2 rounded-full transition-colors" style={{ color: 'var(--syn-muted, #727a6d)' }}>
                <FiX size={22} />
              </button>
            </div>
          </div>
          <div className="p-6 flex flex-col items-center justify-center min-h-[500px]" style={{ background: 'var(--syn-surface, #fbfcf9)' }}>
            {renderModalContent()}
            {modalViewMode === '2D' && (
              <div className="flex gap-6 mt-6 justify-center w-full max-w-3xl pt-4" style={{ borderTop: '1px solid var(--syn-line, #d4d9d0)' }}>
                <div className="flex items-center gap-2"><div className="w-4 h-4 opacity-40" style={{ background: '#94a3b8', border: '1px solid #64748b' }} /><span className="text-xs font-medium" style={{ color: 'var(--syn-muted)' }}>Run 1 (Old) Size</span></div>
                <div className="flex items-center gap-2"><div className="w-4 h-4 opacity-60" style={{ background: '#ef4444', border: '1px solid #dc2626' }} /><span className="text-xs font-medium" style={{ color: 'var(--syn-muted)' }}>Run 2 (New) Growth</span></div>
                <div className="flex items-center gap-2"><div className="w-4 h-4" style={{ border: '2px dashed #64748b' }} /><span className="text-xs font-medium" style={{ color: 'var(--syn-muted)' }}>Internal Defect</span></div>
                <div className="flex items-center gap-2"><div className="w-4 h-4" style={{ border: '2px solid #64748b' }} /><span className="text-xs font-medium" style={{ color: 'var(--syn-muted)' }}>External Defect</span></div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Feature detail */}
      {tooltipOpen && (
        <>
          <div className="fixed inset-0 z-[1000000]" onClick={closeTooltip} />
          <div
            className="fixed z-[1000001] rounded-lg p-3 text-xs w-64 pointer-events-auto"
            style={{
              background: 'var(--syn-surface-raised, #fff)',
              border: '1px solid var(--syn-line, #d4d9d0)',
              boxShadow: 'var(--syn-shadow)',
              ...(() => {
                const placement = clampTooltipPosition({
                  pointerX: tooltipPos.x, pointerY: tooltipPos.y,
                  tooltipWidth: 256, tooltipHeight: 360,
                  viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
                });
                return { left: placement.left, top: placement.top };
              })(),
            }}
          >
            <div className="font-bold pb-1 mb-2 flex justify-between items-center gap-2" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', color: 'var(--syn-ink, #151711)' }}>
              <span>ID: {tooltipTitle}</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${tooltipBadge.good ? 'text-green-700' : 'text-red-700'}`}
                style={{ background: tooltipBadge.good ? 'var(--syn-success-soft, #e4f7ec)' : 'var(--syn-danger-soft, #fee9e6)' }}
              >
                {tooltipBadge.label}
              </span>
            </div>
            <div className="flex flex-col gap-1 mb-3">
              {tooltipRows.map(([label, value], i) => (
                <div key={label} className="flex justify-between gap-2 pb-1" style={{ borderBottom: i < tooltipRows.length - 1 ? '1px solid var(--syn-line, #d4d9d0)' : 'none' }}>
                  <span style={{ color: 'var(--syn-muted, #727a6d)' }} className="font-medium">{label}:</span>
                  <span className="font-bold text-right" style={{ color: 'var(--syn-ink, #151711)' }}>{value}</span>
                </div>
              ))}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (tooltipRowIdx !== undefined && tooltipRowIdx !== null) onSelectRowIdx?.(tooltipRowIdx);
                closeTooltip();
                if (isModalOpen) setIsModalOpen(false);
              }}
              className="syn-btn syn-btn--sm syn-btn--ink w-full"
            >
              Find &amp; Highlight in Table
            </button>
          </div>
        </>
      )}
    </div>
  );
}
