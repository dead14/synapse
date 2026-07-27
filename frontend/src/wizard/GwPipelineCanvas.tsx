import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

import {
  rawLdForTimelineMarker,
  type GwTimelineMatch,
  type TimelineFeatureEvidence,
  type TimelineGeometry,
  type TimelineStatus,
} from '../domain/gwTimeline';

type Props = {
  matches: GwTimelineMatch[];
  timeline: TimelineGeometry;
  zoom: number;
  oldRunLabel: string;
  newRunLabel: string;
  selectedMatchId?: string | number;
  isLoading: boolean;
  statusFor: (match: GwTimelineMatch) => TimelineStatus;
  onSelectMatch: (match: GwTimelineMatch) => void;
};

const CHART_H = 100;
const AXIS_LEFT = 56;
const AXIS_RIGHT = 16;
const NAV_H = 56;
const NAV_PAD = 48;

const distanceLabel = (distance: number) => (
  Math.abs(distance) >= 1_000 ? `${(distance / 1_000).toFixed(2)} km` : `${distance.toFixed(2)} m`
);

const sameDistance = (left: unknown, right: number) => (
  Number.isFinite(Number(left)) && Math.abs(Number(left) - right) < 0.0005
);

const featureKind = (feature: TimelineFeatureEvidence) => {
  const value = String(feature.type ?? '').trim().toLowerCase();
  if (/\bvalve\b/.test(value)) return 'valve';
  if (/\b(?:tee|offtake|branch)\b/.test(value)) return 'tee';
  return 'weld';
};

const matchForFeature = (
  matches: GwTimelineMatch[],
  feature: TimelineFeatureEvidence & { displayDistanceM: number },
  side: 'old' | 'new',
) => matches.find((candidate) => {
  const candidateId = side === 'old' ? candidate.oldId : candidate.newId;
  if (feature.id !== null && feature.id !== undefined && candidateId !== null && candidateId !== undefined) {
    return String(feature.id) === String(candidateId);
  }
  return sameDistance(side === 'old' ? candidate.oldVal : candidate.newVal, feature.displayDistanceM);
});

const colorForStatus = (status: TimelineStatus) => {
  if (status === 'matched') return '#22c55e'; // green
  if (status === 'missing') return '#ef4444'; // red
  if (status === 'review') return '#f97316'; // orange
  if (status === 'excluded') return '#94a3b8'; // slate
  return 'var(--syn-muted, #727a6d)';
};

export default function GwPipelineCanvas({
  matches,
  timeline,
  zoom,
  oldRunLabel,
  newRunLabel,
  selectedMatchId,
  isLoading,
  statusFor,
  onSelectMatch,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  
  const [viewStart, setViewStart] = useState<number | null>(null);
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const [navDrag, setNavDrag] = useState<{ startX: number; origStart: number; origEnd: number } | null>(null);

  const [previousSelectedId, setPreviousSelectedId] = useState<string>('');
  const [currentSelectedId, setCurrentSelectedId] = useState<string>('');

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

  const startDist = timeline.domain.startM;
  const endDist = timeline.domain.endM;
  const totalLength = Math.max(10, endDist - startDist);

  useEffect(() => {
    if (viewStart === null) {
      const windowSize = Math.min(totalLength, 40);
      setViewStart(startDist);
      setViewEnd(startDist + windowSize);
    }
  }, [viewStart, startDist, totalLength]);

  useEffect(() => {
    if (viewStart !== null && viewEnd !== null) {
       const center = (viewStart + viewEnd) / 2;
       const span = Math.max(10, totalLength * (100 / zoom));
       let ns = center - span / 2;
       let ne = center + span / 2;
       if (ns < startDist) { ne += startDist - ns; ns = startDist; }
       if (ne > endDist) { ns -= ne - endDist; ne = endDist; }
       setViewStart(Math.max(startDist, ns));
       setViewEnd(Math.min(endDist, ne));
    }
  }, [zoom, startDist, endDist, totalLength]); // Explicit zoom dependency to pan correctly when buttons click

  const vStart = viewStart ?? startDist;
  const vEnd = viewEnd ?? endDist;
  const viewSpan = Math.max(0.1, vEnd - vStart);
  const chartWidth = Math.max(100, containerWidth - AXIS_LEFT - AXIS_RIGHT);

  const mToX = useCallback((m: number) => AXIS_LEFT + ((m - vStart) / viewSpan) * chartWidth, [vStart, viewSpan, chartWidth]);

  const oldGwFeatures = useMemo(
    () => timeline.oldFeatures.filter((feature) => featureKind(feature) === 'weld'),
    [timeline.oldFeatures],
  );
  const newGwFeatures = useMemo(
    () => timeline.newFeatures.filter((feature) => featureKind(feature) === 'weld'),
    [timeline.newFeatures],
  );

  const selectedId = selectedMatchId === undefined ? '' : String(selectedMatchId);

  useEffect(() => {
    if (selectedId && selectedId !== currentSelectedId) {
      setPreviousSelectedId(currentSelectedId);
      setCurrentSelectedId(selectedId);
    }
  }, [selectedId, currentSelectedId]);

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

  const renderNavigator = () => {
    const navWidth = containerWidth - NAV_PAD * 2;
    const navMToX = (m: number) => NAV_PAD + ((m - startDist) / totalLength) * navWidth;
    const winLeft = navMToX(vStart);
    const winRight = navMToX(vEnd);
    const winWidth = Math.max(4, winRight - winLeft);

    const gwList = Array.from(new Set([...oldGwFeatures, ...newGwFeatures].map(f => f.displayDistanceM))).sort((a, b) => a - b);
    const sampledGwList = gwList.filter((_, i) => i % Math.max(1, Math.floor(gwList.length / 50)) === 0);

    return (
      <div className="relative select-none" style={{ height: NAV_H }}>
        <svg width={containerWidth} height={NAV_H} className="block">
          <rect x={NAV_PAD} y={20} width={navWidth} height={16} rx={4} fill="var(--syn-canvas-strong, #dfe5dc)" />
          {sampledGwList.map((dist, i) => {
            const x = navMToX(dist);
            return (
              <g key={`nav-gw-${i}`}>
                <line x1={x} y1={18} x2={x} y2={38} stroke="var(--syn-muted, #727a6d)" strokeWidth="1" />
                <circle cx={x} cy={28} r={2.5} fill="var(--syn-muted, #727a6d)" />
              </g>
            );
          })}
          {sampledGwList.filter((_, i) => i % Math.max(1, Math.floor(sampledGwList.length / 10)) === 0 || i === sampledGwList.length - 1).map((dist, i) => (
            <text key={`nav-label-${i}`} x={navMToX(dist)} y={50} textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--syn-muted, #727a6d)">
              {dist.toFixed(0)}
            </text>
          ))}
          <rect
            x={winLeft} y={16} width={winWidth} height={24} rx={4}
            fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth="1.5"
            className="cursor-grab active:cursor-grabbing"
            onMouseDown={handleNavMouseDown}
          />
          <line x1={winLeft + winWidth / 2 - 6} y1={24} x2={winLeft + winWidth / 2 - 6} y2={34} stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" />
          <line x1={winLeft + winWidth / 2} y1={24} x2={winLeft + winWidth / 2} y2={34} stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" />
          <line x1={winLeft + winWidth / 2 + 6} y1={24} x2={winLeft + winWidth / 2 + 6} y2={34} stroke="#3b82f6" strokeWidth="1" strokeLinecap="round" />
        </svg>

        <button type="button" onClick={() => shiftView(-1)} className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--syn-surface-raised, #fff)', border: '1px solid var(--syn-line, #d4d9d0)' }} aria-label="Shift view left">
          <FiChevronLeft size={14} />
        </button>
        <button type="button" onClick={() => shiftView(1)} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--syn-surface-raised, #fff)', border: '1px solid var(--syn-line, #d4d9d0)' }} aria-label="Shift view right">
          <FiChevronRight size={14} />
        </button>
      </div>
    );
  };

  const renderPanel = (side: 'new' | 'old', label: string) => {
    const isNew = side === 'new';
    const features = isNew ? timeline.newFeatures : timeline.oldFeatures;
    const yOffset = isNew ? 0 : CHART_H + 18;

    return (
      <g transform={`translate(0, ${yOffset})`}>
        <rect x={AXIS_LEFT} y={0} width={chartWidth} height={CHART_H} fill="var(--syn-surface, #fbfcf9)" />
        <text x={8} y={CHART_H / 2} textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="800" fill="var(--syn-info, #155eef)" transform={`rotate(-90 8 ${CHART_H / 2})`} letterSpacing="0.08em">
          {isNew ? 'NEW' : 'OLD'}
        </text>
        <text x={AXIS_LEFT + 6} y={13} fontSize="10" fontWeight="700" fill="var(--syn-muted, #727a6d)" letterSpacing="0.04em">{label}</text>
        
        <line x1={AXIS_LEFT} y1={CHART_H / 2} x2={AXIS_LEFT + chartWidth} y2={CHART_H / 2} stroke="var(--syn-line, #d4d9d0)" strokeWidth="0.5" strokeDasharray="3 3" />
        
        {features.map((f, i) => {
          const x = mToX(f.displayDistanceM);
          if (x < AXIS_LEFT - 10 || x > AXIS_LEFT + chartWidth + 10) return null;
          
          const match = matchForFeature(matches, f, side);
          const status = match ? statusFor(match) : 'missing';
          const isSel = match && String(match.id) === selectedId;
          const color = colorForStatus(status);
          const kind = featureKind(f);

          return (
            <g
              key={`${side}-${i}`}
              className={match ? 'cursor-pointer' : ''}
              onClick={() => match && onSelectMatch(match)}
              style={{ pointerEvents: match ? 'all' : 'none' }}
            >
              <line x1={x} y1={0} x2={x} y2={CHART_H} stroke="var(--syn-line, #d4d9d0)" strokeWidth="1" strokeDasharray="2 4" />
              {isSel && <circle cx={x} cy={CHART_H / 2} r={11} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 2" opacity="0.5" />}
              
              {kind === 'weld' && <circle cx={x} cy={CHART_H / 2} r={isSel ? 7 : 5} fill={color} stroke={isSel ? '#151711' : '#fff'} strokeWidth={1.5} />}
              {kind === 'valve' && <rect x={x - (isSel?5:4)} y={CHART_H / 2 - (isSel?5:4)} width={isSel?10:8} height={isSel?10:8} fill="none" stroke={color} strokeWidth={2} />}
              {kind === 'tee' && <polygon points={`${x},${CHART_H / 2 - (isSel?6:5)} ${x - (isSel?5:4)},${CHART_H / 2 + (isSel?5:4)} ${x + (isSel?5:4)},${CHART_H / 2 + (isSel?5:4)}`} fill="none" stroke={color} strokeWidth={2} />}
            </g>
          );
        })}
      </g>
    );
  };

  const renderDistanceAxis = () => {
    const tickCount = Math.min(20, Math.max(5, Math.floor(chartWidth / 60)));
    const step = viewSpan / tickCount;
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i++) ticks.push(vStart + i * step);
    return (
      <g transform={`translate(0, ${CHART_H})`}>
        <rect x={AXIS_LEFT} y={0} width={chartWidth} height={18} fill="var(--syn-surface, #fbfcf9)" />
        {ticks.map((m, i) => {
          const x = mToX(m);
          if (x < AXIS_LEFT - 10 || x > AXIS_LEFT + chartWidth + 10) return null;
          return (
            <g key={`xtick-${i}`}>
              <line x1={x} y1={0} x2={x} y2={4} stroke="var(--syn-line-strong, #b7beb2)" strokeWidth="1" />
              <text x={x} y={14} textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--syn-muted, #727a6d)">{m.toFixed(0)} m</text>
            </g>
          );
        })}
      </g>
    );
  };

  const prevMatch = matches.find(m => String(m.id) === previousSelectedId);
  const currMatch = matches.find(m => String(m.id) === currentSelectedId);
  const isMeasuring = prevMatch && currMatch && prevMatch.id !== currMatch.id;
  const spacingBetween = (left: GwTimelineMatch, right: GwTimelineMatch, side: 'old' | 'new') => {
    const leftDistance = rawLdForTimelineMarker(null, left, side);
    const rightDistance = rawLdForTimelineMarker(null, right, side);
    return leftDistance === null || rightDistance === null
      ? null
      : Math.abs(rightDistance - leftDistance);
  };
  const rawOldSpool = isMeasuring && prevMatch && currMatch ? spacingBetween(prevMatch, currMatch, 'old') : null;
  const rawNewSpool = isMeasuring && prevMatch && currMatch ? spacingBetween(prevMatch, currMatch, 'new') : null;
  const masterOldSpool = isMeasuring && prevMatch && currMatch
    ? Math.abs(Number(currMatch.oldVal) - Number(prevMatch.oldVal))
    : null;
  const masterNewSpool = isMeasuring && prevMatch && currMatch
    ? Math.abs(Number(currMatch.newVal) - Number(prevMatch.newVal))
    : null;
  const lengthDifference = rawOldSpool !== null && rawNewSpool !== null
    ? Math.abs(rawOldSpool - rawNewSpool)
    : null;

  return (
    <div ref={containerRef} className="syn-panel flex flex-col overflow-hidden gw-pipeline relative" style={{ padding: 0, background: 'var(--syn-surface, #fbfcf9)', border: '1px solid var(--syn-line, #d4d9d0)', borderRadius: '0.5rem' }}>
      
      {isMeasuring && (
        <div style={{ margin: '0.75rem', background: '#eff6ff', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid #93c5fd', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <strong style={{color: '#1d4ed8', fontSize: '0.875rem'}}>Selected GW spacing</strong>
          <div style={{fontSize: '0.875rem', display: 'flex', gap: '1.25rem', fontWeight: 600, flexWrap: 'wrap'}}>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>OLD raw:</span> {rawOldSpool !== null && Number.isFinite(rawOldSpool) ? distanceLabel(rawOldSpool) : '-'}</div>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>NEW raw:</span> {rawNewSpool !== null && Number.isFinite(rawNewSpool) ? distanceLabel(rawNewSpool) : '-'}</div>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>LD:</span> <strong style={{ color: lengthDifference !== null && lengthDifference <= 0.5 ? '#15803d' : '#b45309' }}>{lengthDifference !== null ? distanceLabel(lengthDifference) : '-'}</strong></div>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>Master:</span> {masterOldSpool !== null && masterNewSpool !== null && Number.isFinite(masterOldSpool) && Number.isFinite(masterNewSpool) ? `${distanceLabel(masterOldSpool)} / ${distanceLabel(masterNewSpool)}` : '-'}</div>
          </div>
          <button onClick={() => setPreviousSelectedId('')} style={{background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, padding: 0, fontSize: '1.2rem', marginLeft: 'auto'}} aria-label="Close measurement">✕</button>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/50 backdrop-blur-[1px]">
           <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-2" />
           <span className="text-sm font-semibold text-gray-700">Updating alignment...</span>
        </div>
      )}

      <svg width={containerWidth} height={CHART_H * 2 + 18} className="block relative z-0">
        <g opacity={0.6}>
          {matches.map((match, i) => {
             const status = statusFor(match);
             if (status === 'missing') return null;
             
             const xNew = mToX(Number(match.newVal));
             const xOld = mToX(Number(match.oldVal));
             
             if ((xNew < AXIS_LEFT && xOld < AXIS_LEFT) || (xNew > AXIS_LEFT + chartWidth && xOld > AXIS_LEFT + chartWidth)) return null;
             
             const isSel = String(match.id) === selectedId;
             const color = colorForStatus(status);
             const strokeWidth = isSel ? 2 : 1;
             const lineOpacity = isSel ? 1 : 0.4;
             
             return (
                <line 
                  key={`link-${i}`} 
                  x1={xNew} y1={CHART_H} 
                  x2={xOld} y2={CHART_H + 18} 
                  stroke={color} strokeWidth={strokeWidth} opacity={lineOpacity}
                />
             );
          })}
        </g>
        
        {renderPanel('new', newRunLabel)}
        {renderDistanceAxis()}
        {renderPanel('old', oldRunLabel)}
      </svg>
      
      <div style={{ borderTop: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
        {renderNavigator()}
      </div>

    </div>
  );
}
