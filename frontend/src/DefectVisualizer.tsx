import React from 'react';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { FiBox, FiX, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import Modal from './components/common/Modal';
import { apiFetch } from './utils/api';
import { extentOf } from './utils/numericRange.ts';
import { clampTooltipPosition } from './utils/tooltipPosition';
import { parseClockToDegrees } from './utils/clock';

interface DefectVisualizerProps {
  data: any[];
  selectedRowIdx?: number | null;
  onSelectRowIdx?: (idx: number | null) => void;
}

const MAX_TIMELINE_FEATURES = 2_500;
const MAX_TIMELINE_GWS = 1_500;
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

function clockDegreesToHours(deg: number): number {
  const h = (deg / 360) * 12;
  return h === 0 ? 12 : h;
}

function formatClockLabel(deg: number): string {
  const h = Math.round(clockDegreesToHours(deg));
  return `${String(h === 0 ? 12 : h).padStart(2, '0')}:00`;
}

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

const CHART_H = 140;
const AXIS_LEFT = 56;
const AXIS_RIGHT = 16;
const CHART_PAD_TOP = 14;
const CHART_PAD_BOT = 6;
const CLOCK_TICKS = [0, 90, 180, 270];
const NAV_H = 56;
const NAV_PAD = 48;

export default function DefectVisualizer({ data, selectedRowIdx, onSelectRowIdx }: DefectVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [viewStart, setViewStart] = useState<number | null>(null);
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const [navDrag, setNavDrag] = useState<{ startX: number; origStart: number; origEnd: number } | null>(null);
  const [rangeStartGw, setRangeStartGw] = useState<number | null>(null);
  const [rangeEndGw, setRangeEndGw] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalViewMode, setModalViewMode] = useState<'2D' | '3D'>('3D');
  const [hoveredDefect, setHoveredDefect] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [runOldName, setRunOldName] = useState('OLD');
  const [runNewName, setRunNewName] = useState('NEW');
  const [oldRawFeatures, setOldRawFeatures] = useState<any[]>([]);
  const [newRawFeatures, setNewRawFeatures] = useState<any[]>([]);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setContainerWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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
            if (oldY) setRunOldName(`ILI ${oldY}`);
            if (newY) setRunNewName(`ILI ${newY}`);
            if (config?.summaryData?.oldRun?.rawFeatures) setOldRawFeatures(config.summaryData.oldRun.rawFeatures);
            if (config?.summaryData?.newRun?.rawFeatures) setNewRawFeatures(config.summaryData.newRun.rawFeatures);
          }
        }
      } catch {}
    };
    fetchSession();
  }, []);

  // Parse data
  const parsedData = useMemo(() => {
    return data.map((item, idx) => {
      if (!item) return null;
      const r1Dist = parseFloat(item['Log Dist OLD (m)']);
      const r2Dist = parseFloat(item['Log Dist NEW (m)']);
      const isMatched = !isNaN(r1Dist) && !isNaN(r2Dist);
      const r1Depth = parseFloat(item['Depth OLD (%WT)']) || 0;
      const r2Depth = parseFloat(item['Depth NEW (%WT)']) || 0;
      const isExt1 = isExternalSurface(item['Int/Ext OLD'] ?? item['Surface OLD']);
      const isExt2 = isExternalSurface(item['Int/Ext NEW'] ?? item['Surface NEW']);
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
        orient1: parseClockToDegrees(item["O'Clock OLD"]),
        depth1: r1Depth, isExt1, isWeld1, isValve1, isTee1,
        id2: (item['Identif. NEW'] && item['Identif. NEW'] !== '-') ? String(item['Identif. NEW']) : (item['Log Dist NEW (m)'] !== undefined && item['Log Dist NEW (m)'] !== '') ? `DIST:${item['Log Dist NEW (m)']}` : null,
        dist2: isNaN(r2Dist) ? null : r2Dist,
        len2: parseFloat(item['Length NEW (mm)']) || 10,
        wid2: parseFloat(item['Width NEW (mm)']) || 10,
        orient2: parseClockToDegrees(item["O'Clock NEW"]),
        depth2: r2Depth, isExt2, isWeld2, isValve2, isTee2,
        isMatched, rawItem: item, dataIdx: idx,
      };
    }).filter(Boolean);
  }, [data]);

  const timelineData = useMemo(() => sampleEvenly(
    parsedData,
    MAX_TIMELINE_FEATURES,
    (item: any) => item.dataIdx === selectedRowIdx,
  ), [parsedData, selectedRowIdx]);

  // Distance boundaries
  const availableDistances = parsedData.flatMap(d => [d?.dist1, d?.dist2]).filter((d): d is number => Number.isFinite(d));
  const distanceExtent = extentOf(availableDistances);
  const minDistance = distanceExtent.min;
  const maxDistance = distanceExtent.max;
  const totalLength = Math.max(10, maxDistance - minDistance + 4);
  const startDist = Math.max(0, minDistance - 2);
  const endDist = startDist + totalLength;

  // GW list
  const gwList = useMemo(() => {
    const list = parsedData
      .filter((d: any) => d !== null)
      .filter(d => (d.isWeld1 && d.dist1 !== null) || (d.isWeld2 && d.dist2 !== null && d.dist1 !== null))
      .map(d => d.dist1 as number)
      .sort((a, b) => a - b);
    if (list.length === 0) {
      for (let d = startDist; d <= endDist; d += 12) list.push(d);
    }
    return sampleEvenly(Array.from(new Set(list)), MAX_TIMELINE_GWS);
  }, [parsedData, startDist, endDist]);

  // Default view: show ~40m or full pipeline if shorter
  useEffect(() => {
    if (viewStart === null) {
      const windowSize = Math.min(totalLength, 40);
      setViewStart(startDist);
      setViewEnd(startDist + windowSize);
    }
  }, [viewStart, startDist, totalLength]);

  const vStart = viewStart ?? startDist;
  const vEnd = viewEnd ?? endDist;
  const viewSpan = vEnd - vStart;
  const chartWidth = containerWidth - AXIS_LEFT - AXIS_RIGHT;

  const mToX = useCallback((m: number) => AXIS_LEFT + ((m - vStart) / viewSpan) * chartWidth, [vStart, viewSpan, chartWidth]);
  const clockToY = useCallback((deg: number) => CHART_PAD_TOP + (deg / 360) * (CHART_H - CHART_PAD_TOP - CHART_PAD_BOT), []);

  // GWs visible in current window
  const visibleGws = useMemo(() => gwList.filter(d => d >= vStart - 2 && d <= vEnd + 2), [gwList, vStart, vEnd]);

  // Joint lengths between consecutive visible GWs
  const jointLengths = useMemo(() => {
    const result: { startDist: number; endDist: number; length: number; cx: number }[] = [];
    for (let i = 0; i < visibleGws.length - 1; i++) {
      const s = visibleGws[i];
      const e = visibleGws[i + 1];
      const len = e - s;
      result.push({ startDist: s, endDist: e, length: len, cx: (mToX(s) + mToX(e)) / 2 });
    }
    return result;
  }, [visibleGws, mToX]);

  // Selected spool range for 3D
  let selectedRange: { startDist: number; endDist: number; length: number; startIdx: number; endIdx: number } | null = null;
  if (rangeStartGw !== null && rangeEndGw !== null) {
    const si = Math.min(rangeStartGw, rangeEndGw);
    const ei = Math.max(rangeStartGw, rangeEndGw);
    if (si !== ei && gwList[si] !== undefined && gwList[ei] !== undefined) {
      selectedRange = { startDist: gwList[si], endDist: gwList[ei], length: gwList[ei] - gwList[si], startIdx: si, endIdx: ei };
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

  // Navigator drag
  const handleNavMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setNavDrag({ startX: e.clientX, origStart: vStart, origEnd: vEnd });
  }, [vStart, vEnd]);

  useEffect(() => {
    if (!navDrag) return;
    const onMove = (e: MouseEvent) => {
      const navWidth = containerWidth - NAV_PAD * 2;
      const pxPerMeter = navWidth / totalLength;
      const deltaPx = e.clientX - navDrag.startX;
      const deltaM = deltaPx / pxPerMeter;
      let newStart = navDrag.origStart + deltaM;
      let newEnd = navDrag.origEnd + deltaM;
      if (newStart < startDist) { newEnd += startDist - newStart; newStart = startDist; }
      if (newEnd > endDist) { newStart -= newEnd - endDist; newEnd = endDist; }
      setViewStart(Math.max(startDist, newStart));
      setViewEnd(Math.min(endDist, newEnd));
    };
    const onUp = () => setNavDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [navDrag, containerWidth, totalLength, startDist, endDist]);

  const shiftView = useCallback((direction: -1 | 1) => {
    const step = viewSpan * 0.3;
    let ns = vStart + direction * step;
    let ne = vEnd + direction * step;
    if (ns < startDist) { ne += startDist - ns; ns = startDist; }
    if (ne > endDist) { ns -= ne - endDist; ne = endDist; }
    setViewStart(Math.max(startDist, ns));
    setViewEnd(Math.min(endDist, ne));
  }, [vStart, vEnd, viewSpan, startDist, endDist]);

  // Anomaly dot color
  const dotColor = (d: any, side: 'new' | 'old') => {
    if (d.isMatched) return '#22c55e'; // green - matched
    if (side === 'new') return '#3b82f6'; // blue - new anomaly
    return '#f97316'; // orange - old only / engineering review
  };

  const dotRadius = (d: any, isSel: boolean) => isSel ? 7 : 4.5;

  // Anomaly click
  const handleDotClick = (d: any, e: React.MouseEvent | { clientX: number; clientY: number }) => {
    setHoveredDefect(d);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  // ─── render one chart panel (NEW or OLD) ───

  const renderPanel = (side: 'new' | 'old', label: string) => {
    const isNew = side === 'new';
    return (
      <svg width={containerWidth} height={CHART_H} className="block">
        {/* Background */}
        <rect x={AXIS_LEFT} y={0} width={chartWidth} height={CHART_H} fill="var(--syn-surface, #fbfcf9)" rx="0" />

        {/* Y-axis label */}
        <text x={8} y={CHART_H / 2} textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="800" fill="var(--syn-info, #155eef)" transform={`rotate(-90 8 ${CHART_H / 2})`} letterSpacing="0.08em">
          {isNew ? 'NEW' : 'OLD'}
        </text>

        {/* Run label */}
        <text x={AXIS_LEFT + 6} y={13} fontSize="10" fontWeight="700" fill="var(--syn-muted, #727a6d)" letterSpacing="0.04em">{label}</text>

        {/* Clock position grid lines */}
        {CLOCK_TICKS.map(deg => {
          const y = clockToY(deg);
          return (
            <g key={`ck-${deg}`}>
              <line x1={AXIS_LEFT} y1={y} x2={AXIS_LEFT + chartWidth} y2={y} stroke="var(--syn-line, #d4d9d0)" strokeWidth="0.5" strokeDasharray="3 3" />
              <text x={AXIS_LEFT - 5} y={y} textAnchor="end" dominantBaseline="central" fontSize="9" fontWeight="700" fill="var(--syn-muted, #727a6d)">
                {formatClockLabel(deg)}
              </text>
            </g>
          );
        })}

        {/* GW vertical lines and markers */}
        {visibleGws.map((dist, i) => {
          const x = mToX(dist);
          if (x < AXIS_LEFT - 5 || x > AXIS_LEFT + chartWidth + 5) return null;
          const gwIdx = gwList.indexOf(dist);
          const isGwSelected = (rangeStartGw === gwIdx && rangeEndGw === null) || (selectedRange && gwIdx >= selectedRange.startIdx && gwIdx <= selectedRange.endIdx);
          return (
            <g key={`gw-${side}-${i}`}>
              <line x1={x} y1={0} x2={x} y2={CHART_H} stroke="var(--syn-line, #d4d9d0)" strokeWidth="0.5" strokeDasharray="2 4" />
              <circle
                cx={x} cy={8} r={5}
                fill="none"
                stroke={isGwSelected ? '#eab308' : 'var(--syn-muted, #727a6d)'}
                strokeWidth={isGwSelected ? 2 : 1}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`GW at ${dist.toFixed(1)} m`}
                onClick={() => handleGwClick(gwIdx)}
                onKeyDown={svgActionKeyDown(() => handleGwClick(gwIdx))}
              />
            </g>
          );
        })}

        {/* Joint length labels (only on new panel) */}
        {isNew && jointLengths.map((jl, i) => (
          <text key={`jl-${i}`} x={jl.cx} y={8} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill="var(--syn-info, #155eef)">
            {jl.length.toFixed(1)} m
          </text>
        ))}

        {/* Anomaly dots */}
        {timelineData.map((d, i) => {
          const dist = isNew ? d.dist2 : d.dist1;
          const orient = isNew ? d.orient2 : d.orient1;
          if (dist === null || dist === undefined) return null;
          if (dist < vStart || dist > vEnd) return null;
          const x = mToX(dist);
          const y = clockToY(orient);
          const isSel = selectedRowIdx !== null && selectedRowIdx !== undefined && d.dataIdx === selectedRowIdx;
          const r = dotRadius(d, isSel);
          const color = dotColor(d, side);
          return (
            <g
              key={`dot-${side}-${i}`}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Feature ${isNew ? d.id2 : d.id1} at ${dist.toFixed(1)} m`}
              onClick={(e) => { e.stopPropagation(); handleDotClick(d, e); }}
              onKeyDown={svgActionKeyDown((cx, cy) => handleDotClick(d, { clientX: cx, clientY: cy }))}
            >
              {isSel && <circle cx={x} cy={y} r={r + 4} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 2" opacity="0.5" />}
              <circle cx={x} cy={y} r={r} fill={color} stroke={isSel ? 'var(--syn-ink, #151711)' : '#fff'} strokeWidth={isSel ? 2 : 1} />
            </g>
          );
        })}
      </svg>
    );
  };

  // ─── Navigator ───

  const renderNavigator = () => {
    const navWidth = containerWidth - NAV_PAD * 2;
    const navMToX = (m: number) => NAV_PAD + ((m - startDist) / totalLength) * navWidth;
    const winLeft = navMToX(vStart);
    const winRight = navMToX(vEnd);
    const winWidth = winRight - winLeft;

    return (
      <div className="relative select-none" style={{ height: NAV_H }}>
        <svg width={containerWidth} height={NAV_H} className="block">
          {/* Track */}
          <rect x={NAV_PAD} y={20} width={navWidth} height={16} rx={4} fill="var(--syn-canvas-strong, #dfe5dc)" />

          {/* GW markers on navigator */}
          {gwList.map((dist, i) => {
            const x = navMToX(dist);
            return (
              <g key={`nav-gw-${i}`}>
                <line x1={x} y1={18} x2={x} y2={38} stroke="var(--syn-muted, #727a6d)" strokeWidth="1" />
                <circle cx={x} cy={28} r={2.5} fill="var(--syn-muted, #727a6d)" />
              </g>
            );
          })}

          {/* GW labels (every few) */}
          {gwList.filter((_, i) => i % Math.max(1, Math.floor(gwList.length / 10)) === 0 || i === gwList.length - 1).map((dist, i) => (
            <text key={`nav-label-${i}`} x={navMToX(dist)} y={50} textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--syn-muted, #727a6d)">
              {dist.toFixed(0)}
            </text>
          ))}

          {/* Window highlight */}
          <rect
            x={winLeft} y={16} width={winWidth} height={24} rx={4}
            fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth="1.5"
            className="cursor-grab active:cursor-grabbing"
            onMouseDown={handleNavMouseDown}
          />
          {/* Window grips */}
          <line x1={winLeft + winWidth / 2 - 6} y1={24} x2={winLeft + winWidth / 2 - 6} y2={34} stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" />
          <line x1={winLeft + winWidth / 2} y1={24} x2={winLeft + winWidth / 2} y2={34} stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" />
          <line x1={winLeft + winWidth / 2 + 6} y1={24} x2={winLeft + winWidth / 2 + 6} y2={34} stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" />
        </svg>

        {/* Shift buttons */}
        <button
          type="button"
          onClick={() => shiftView(-1)}
          className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: 'var(--syn-surface-raised, #fff)', border: '1px solid var(--syn-line, #d4d9d0)' }}
          aria-label="Shift view left"
        >
          <FiChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => shiftView(1)}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: 'var(--syn-surface-raised, #fff)', border: '1px solid var(--syn-line, #d4d9d0)' }}
          aria-label="Shift view right"
        >
          <FiChevronRight size={14} />
        </button>
      </div>
    );
  };

  // ─── Distance axis (shared between both panels) ───

  const renderDistanceAxis = () => {
    const tickCount = Math.min(20, Math.max(5, Math.floor(chartWidth / 60)));
    const step = viewSpan / tickCount;
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i++) ticks.push(vStart + i * step);
    return (
      <svg width={containerWidth} height={18} className="block">
        {ticks.map((m, i) => {
          const x = mToX(m);
          return (
            <g key={`xtick-${i}`}>
              <line x1={x} y1={0} x2={x} y2={4} stroke="var(--syn-line-strong, #b7beb2)" strokeWidth="1" />
              <text x={x} y={14} textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--syn-muted, #727a6d)">{m.toFixed(0)} m</text>
            </g>
          );
        })}
      </svg>
    );
  };

  // ─── 3D modal content ───

  const renderModalContent = () => {
    if (!selectedRange) return null;
    const spoolData = parsedData.filter(d => {
      if (d === null) return false;
      const dist = d.dist1 !== null ? d.dist1 : d.dist2;
      if (dist === null) return false;
      return dist >= selectedRange.startDist && dist <= selectedRange.endDist;
    });
    const renderableSpoolData = sampleEvenly(spoolData, MAX_SPOOL_FEATURES, (item: any) => item.dataIdx === selectedRowIdx);
    const sLength = selectedRange.length;
    const modalSvgWidth = 800;
    const sToX = (dist: number) => ((dist - selectedRange.startDist) / sLength) * modalSvgWidth;

    if (modalViewMode === '2D') {
      const pipeHeight = 240;
      const oToY = (orient: number) => (orient / 360) * pipeHeight;
      return (
        <div className="w-full flex justify-center">
          <div style={{ width: modalSvgWidth, height: pipeHeight + 60 }} className="relative rounded-xl" >
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
              {renderableSpoolData.map((d, i) => {
                const scaleDim = (val: number) => Math.max(10, val * 0.8);
                if (d.isMatched && d.dist1 !== null && d.dist2 !== null) {
                  const cx1 = sToX(d.dist1); const cy1 = oToY(d.orient1) + 30;
                  const w1 = scaleDim(d.len1); const h1 = scaleDim(d.wid1);
                  const cx2 = sToX(d.dist2); const cy2 = oToY(d.orient2) + 30;
                  const w2 = scaleDim(d.len2); const h2 = scaleDim(d.wid2);
                  return (
                    <g key={`2d-m-${i}`} className="cursor-pointer" role="button" tabIndex={0}
                      aria-label={`Matched defect ${d.id1 ?? d.id2 ?? ''}`}
                      onClick={(e) => { e.stopPropagation(); handleDotClick(d, e); }}
                      onKeyDown={svgActionKeyDown((cx, cy) => handleDotClick(d, { clientX: cx, clientY: cy }))}
                    >
                      <line x1={cx1} y1={cy1} x2={cx2} y2={cy2} stroke="#fca5a5" strokeWidth="1" strokeDasharray="2 2" />
                      <ellipse cx={cx1} cy={cy1} rx={w1/2} ry={h1/2} fill={d.isExt1 ? "rgba(148,163,184,0.4)" : "transparent"} stroke="#94a3b8" strokeWidth={d.isExt1 ? "1" : "2"} strokeDasharray={d.isExt1 ? "0" : "2"} />
                      <ellipse cx={cx2} cy={cy2} rx={w2/2} ry={h2/2} fill={d.isExt2 ? "rgba(239,68,68,0.6)" : "transparent"} stroke="#ef4444" strokeWidth={d.isExt2 ? "1" : "2"} strokeDasharray={d.isExt2 ? "0" : "2"} />
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
                    <g key={`2d-u-${i}`} className="cursor-pointer" role="button" tabIndex={0}
                      aria-label={`Unmatched defect ${d.id1 ?? d.id2 ?? ''}`}
                      onClick={(e) => { e.stopPropagation(); handleDotClick(d, e); }}
                      onKeyDown={svgActionKeyDown((cx2, cy2) => handleDotClick(d, { clientX: cx2, clientY: cy2 }))}
                    >
                      <ellipse cx={cx} cy={cy} rx={w/2} ry={h/2} fill={isExt ? color : "transparent"} fillOpacity={0.6} stroke={color} strokeWidth={isExt ? "1" : "2"} strokeDasharray={isExt ? "0" : "2"} />
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
      const renderLength = Math.min(sLength, 200);
      return (
        <div className="w-full h-[400px] rounded-xl overflow-hidden relative" style={{ background: '#1e293b' }}>
          <div className="absolute top-4 left-4 z-10 text-white/70 text-xs">Left Click: Rotate | Right Click: Pan | Scroll: Zoom</div>
          <Canvas camera={{ position: [0, 0, Math.min(20, renderLength / 2)], fov: 45 }}>
            <ambientLight intensity={0.7} />
            <directionalLight position={[10, 20, 10]} intensity={1.5} />
            <OrbitControls enableDamping dampingFactor={0.05} />
            <FEAPipeMesh renderLength={renderLength} sLength={sLength} startDist={selectedRange.startDist} spoolData={renderableSpoolData} gwList={gwList} />
            <DefectOverlayInstancedMesh
              spoolData={renderableSpoolData} renderLength={renderLength} sLength={sLength} startDist={selectedRange.startDist}
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

  // ─── Main render ───

  return (
    <div ref={containerRef} className="syn-panel flex flex-col overflow-hidden" style={{ padding: 0 }}>
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-2" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--syn-ink, #151711)', letterSpacing: '-0.02em' }}>
            Alignment Comparison
          </h3>
          <span className="text-xs" style={{ color: 'var(--syn-muted, #727a6d)' }}>
            {vStart.toFixed(1)} – {vEnd.toFixed(1)} m of {totalLength.toFixed(1)} m
          </span>
          {timelineData.length < parsedData.length && (
            <span className="text-xs font-medium" style={{ color: 'var(--syn-warning, #8a5200)' }}>
              Sampling {timelineData.length.toLocaleString()} / {parsedData.length.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedRange && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="syn-btn syn-btn--sm syn-btn--ink"
            >
              <FiBox size={14} /> 3D View ({selectedRange.length.toFixed(1)} m)
            </button>
          )}
        </div>
      </div>

      {/* NEW chart panel */}
      <div style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)' }}>
        {renderPanel('new', runNewName)}
      </div>

      {/* Shared distance axis */}
      <div style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
        {renderDistanceAxis()}
      </div>

      {/* OLD chart panel */}
      <div style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)' }}>
        {renderPanel('old', runOldName)}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 py-2" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#22c55e" /></svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--syn-ink-soft, #4f554b)' }}>Matched anomaly</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#f97316" /></svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--syn-ink-soft, #4f554b)' }}>Engineering review</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#3b82f6" /></svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--syn-ink-soft, #4f554b)' }}>New anomaly</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="none" stroke="var(--syn-muted, #727a6d)" strokeWidth="1" /></svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--syn-ink-soft, #4f554b)' }}>Girth weld</span>
        </div>
      </div>

      {/* Navigator */}
      <div style={{ background: 'var(--syn-surface, #fbfcf9)' }}>
        <div className="flex items-center justify-between px-4 pt-1.5">
          <span className="text-xs font-bold" style={{ color: 'var(--syn-ink-soft, #4f554b)' }}>Master synchronized navigator</span>
          <span className="text-xs" style={{ color: 'var(--syn-info, #155eef)' }}>Drag the blue window; both OLD and NEW move together</span>
        </div>
        {renderNavigator()}
        <div className="text-center pb-1.5">
          <span className="text-xs" style={{ color: 'var(--syn-muted, #727a6d)' }}>
            Showing {vStart.toFixed(2)}–{vEnd.toFixed(2)} m of {totalLength.toFixed(2)} m
            {visibleGws.length > 1 && ` · GW ${visibleGws[0].toFixed(0)} to GW ${visibleGws[visibleGws.length - 1].toFixed(0)}`}
          </span>
        </div>
      </div>

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
              <p className="text-sm" style={{ color: 'var(--syn-muted, #727a6d)' }}>Distance: {selectedRange?.startDist.toFixed(2)} m to {selectedRange?.endDist.toFixed(2)} m</p>
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

      {/* Tooltip */}
      {hoveredDefect && (
        <>
          <div className="fixed inset-0 z-[1000000]" onClick={() => setHoveredDefect(null)} />
          <div
            className="fixed z-[1000001] rounded-lg p-3 text-xs w-64 pointer-events-auto"
            style={{
              background: 'var(--syn-surface-raised, #fff)',
              border: '1px solid var(--syn-line, #d4d9d0)',
              boxShadow: 'var(--syn-shadow)',
              ...(() => {
                const placement = clampTooltipPosition({
                  pointerX: tooltipPos.x, pointerY: tooltipPos.y,
                  tooltipWidth: 256, tooltipHeight: 320,
                  viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
                });
                return { left: placement.left, top: placement.top };
              })(),
            }}
          >
            <div className="font-bold pb-1 mb-2 flex justify-between items-center gap-2" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', color: 'var(--syn-ink, #151711)' }}>
              <span>ID: {hoveredDefect.id1 || hoveredDefect.id2}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${hoveredDefect.isMatched ? 'text-green-700' : 'text-red-700'}`}
                style={{ background: hoveredDefect.isMatched ? 'var(--syn-success-soft, #e4f7ec)' : 'var(--syn-danger-soft, #fee9e6)' }}>
                {hoveredDefect.isMatched ? 'Matched' : 'Unmatched'}
              </span>
            </div>
            <div className="flex flex-col gap-1 mb-3">
              {[
                ['Dist U/S GW', `${hoveredDefect.rawItem['Dist GW OLD (m)'] || hoveredDefect.rawItem['Dist GW NEW (m)'] || '-'} m`],
                ['Clock', `${hoveredDefect.rawItem["O'Clock OLD"] || hoveredDefect.rawItem["O'Clock NEW"] || '-'}`],
                ['Ext/Int', `${hoveredDefect.rawItem['Int/Ext OLD'] || hoveredDefect.rawItem['Int/Ext NEW'] || hoveredDefect.rawItem['Feature Type OLD'] || (hoveredDefect.isExt1 ? 'External' : 'Internal')}`],
                ['Depth', `${hoveredDefect.rawItem['Depth OLD (%WT)'] || hoveredDefect.rawItem['Depth NEW (%WT)'] || '-'} %WT`],
                ['Length', `${hoveredDefect.rawItem['Length OLD (mm)'] || hoveredDefect.rawItem['Length NEW (mm)'] || '-'} mm`],
                ['Width', `${hoveredDefect.rawItem['Width OLD (mm)'] || hoveredDefect.rawItem['Width NEW (mm)'] || '-'} mm`],
              ].map(([label, value], i) => (
                <div key={i} className="flex justify-between pb-1" style={{ borderBottom: i < 5 ? '1px solid var(--syn-line, #d4d9d0)' : 'none' }}>
                  <span style={{ color: 'var(--syn-muted, #727a6d)' }} className="font-medium">{label}:</span>
                  <span className="font-bold" style={{ color: 'var(--syn-ink, #151711)' }}>{value}</span>
                </div>
              ))}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectRowIdx?.(hoveredDefect.dataIdx);
                setHoveredDefect(null);
                if (isModalOpen) setIsModalOpen(false);
              }}
              className="syn-btn syn-btn--sm syn-btn--ink w-full"
            >
              Find & Highlight in Table
            </button>
          </div>
        </>
      )}
    </div>
  );
}
