import { useEffect, useMemo, useRef, useState } from 'react';

import {
  calculateViewportWindow,
  rawLdForTimelineMarker,
  type GwTimelineMatch,
  type TimelineFeatureEvidence,
  type TimelineGeometry,
  type TimelineStatus,
} from '../domain/gwTimeline';

type ViewportWindow = ReturnType<typeof calculateViewportWindow>;

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

const distanceLabel = (distance: number) => (
  Math.abs(distance) >= 1_000 ? `${(distance / 1_000).toFixed(2)} km` : `${distance.toFixed(2)} m`
);

const sameDistance = (left: unknown, right: number) => (
  Number.isFinite(Number(left)) && Math.abs(Number(left) - right) < 0.0005
);

const distancePercent = (distance: number, domain: TimelineGeometry['domain']) => {
  const span = Math.max(1e-9, domain.endM - domain.startM);
  return Math.min(100, Math.max(0, ((distance - domain.startM) / span) * 100));
};

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

const sourceDistance = (match: GwTimelineMatch, side: 'old' | 'new') => {
  return rawLdForTimelineMarker(null, match, side);
};

const spacingBetween = (left: GwTimelineMatch, right: GwTimelineMatch, side: 'old' | 'new') => {
  const leftDistance = sourceDistance(left, side);
  const rightDistance = sourceDistance(right, side);
  return leftDistance === null || rightDistance === null
    ? null
    : Math.abs(rightDistance - leftDistance);
};

function TrackMarker({
  position,
  sourcePosition,
  domain,
  match,
  side,
  status,
  selected,
  onSelect,
}: {
  position: number;
  sourcePosition?: number | null;
  domain: TimelineGeometry['domain'];
  match?: GwTimelineMatch;
  side: 'old' | 'new';
  status: TimelineStatus;
  selected: boolean;
  onSelect: (match: GwTimelineMatch) => void;
}) {
  const label = distanceLabel(position);
  const rawLd = rawLdForTimelineMarker(sourcePosition, match, side);
  const rawSourceLabel = rawLd === null ? ' · source LD unavailable' : ` · source LD ${distanceLabel(rawLd)}`;
  const markerLabel = `${label} · ${status}${match ? ' pair' : ' feature'}${rawSourceLabel}`;

  return (
    <button
      type="button"
      className={`gw-pipeline-marker is-${status}${selected ? ' is-selected' : ''}`}
      style={{ insetInlineStart: `${distancePercent(position, domain)}%` }}
      aria-label={markerLabel}
      aria-pressed={match ? selected : undefined}
      onClick={() => match && onSelect(match)}
    >
      <span aria-hidden="true" />
      <small>{label}</small>
      <span className="gw-pipeline-marker__raw-label" aria-hidden="true">{rawLd === null ? 'source LD unavailable' : `source LD ${distanceLabel(rawLd)}`}</span>
    </button>
  );
}

function FeatureMarkers({ values, type, domain }: { values: number[]; type: 'valve' | 'tee'; domain: TimelineGeometry['domain'] }) {
  return values.filter(Number.isFinite).map((position, index) => (
    <span
      key={`${type}-${position}-${index}`}
      className={`gw-pipeline-feature is-${type}`}
      style={{ insetInlineStart: `${distancePercent(position, domain)}%` }}
      title={`${type === 'valve' ? 'Valve' : 'Tee'} · ${distanceLabel(position)}`}
      aria-hidden="true"
    />
  ));
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewportWindow>({ leftPercent: 0, widthPercent: 100 });
  const [previousSelectedId, setPreviousSelectedId] = useState<string>('');
  const [currentSelectedId, setCurrentSelectedId] = useState<string>('');

  const domain = timeline.domain;
  const domainSpan = Math.max(1, domain.endM - domain.startM);
  const axisTicks = useMemo(
    () => Array.from({ length: 7 }, (_, index) => domain.startM + (domainSpan / 6) * index),
    [domain.startM, domainSpan],
  );
  const oldGwFeatures = useMemo(
    () => timeline.oldFeatures.filter((feature) => featureKind(feature) === 'weld'),
    [timeline.oldFeatures],
  );
  const newGwFeatures = useMemo(
    () => timeline.newFeatures.filter((feature) => featureKind(feature) === 'weld'),
    [timeline.newFeatures],
  );
  const matchByOldId = useMemo(() => {
    const map = new Map<string, GwTimelineMatch>();
    for (const m of matches) {
      if (m.oldId != null) map.set(String(m.oldId), m);
    }
    return map;
  }, [matches]);
  const matchByNewId = useMemo(() => {
    const map = new Map<string, GwTimelineMatch>();
    for (const m of matches) {
      if (m.newId != null) map.set(String(m.newId), m);
    }
    return map;
  }, [matches]);
  const coverageStyle = (coverage: TimelineGeometry['oldCoverage']) => {
    if (!coverage) return { display: 'none' };
    const startPercent = distancePercent(coverage.startM, domain);
    const endPercent = distancePercent(coverage.endM, domain);
    return {
      insetInlineStart: `${startPercent}%`,
      width: `${Math.max(0, endPercent - startPercent)}%`,
    };
  };

  const updateViewport = () => {
    const element = scrollRef.current;
    if (!element) return;
    setViewport(calculateViewportWindow(element));
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const frame = requestAnimationFrame(updateViewport);
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [zoom, matches.length]);

  const panTo = (centerPercent: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const left = (centerPercent / 100) * element.scrollWidth - element.clientWidth / 2;
    element.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  };

  const selectedId = selectedMatchId === undefined ? '' : String(selectedMatchId);
  const contentWidth = `${Math.max(100, Math.min(10000, zoom))}%`;

  useEffect(() => {
    if (selectedId && selectedId !== currentSelectedId) {
      setPreviousSelectedId(currentSelectedId);
      setCurrentSelectedId(selectedId);
    }
  }, [selectedId, currentSelectedId]);

  const prevMatch = matches.find(m => String(m.id) === previousSelectedId);
  const currMatch = matches.find(m => String(m.id) === currentSelectedId);
  const isMeasuring = prevMatch && currMatch && prevMatch.id !== currMatch.id;
  const rawOldSpool = isMeasuring ? spacingBetween(prevMatch, currMatch, 'old') : null;
  const rawNewSpool = isMeasuring ? spacingBetween(prevMatch, currMatch, 'new') : null;
  const masterOldSpool = isMeasuring
    ? Math.abs(Number(currMatch.oldVal) - Number(prevMatch.oldVal))
    : null;
  const masterNewSpool = isMeasuring
    ? Math.abs(Number(currMatch.newVal) - Number(prevMatch.newVal))
    : null;
  const lengthDifference = rawOldSpool !== null && rawNewSpool !== null
    ? Math.abs(rawOldSpool - rawNewSpool)
    : null;

  return (
    <div className="gw-pipeline" style={{ position: 'relative' }}>
      {isMeasuring && (
        <div style={{
          margin: '0 0 0.75rem',
          background: '#eff6ff',
          padding: '0.75rem 1rem',
          borderRadius: '0.5rem',
          border: '1px solid #93c5fd',
          display: 'flex',
          gap: '1rem',
          alignItems: 'center'
        }}>
          <strong style={{color: '#1d4ed8', fontSize: '0.875rem'}}>Selected GW spacing</strong>
          <div style={{fontSize: '0.875rem', display: 'flex', gap: '1.25rem', fontWeight: 600, flexWrap: 'wrap'}}>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>OLD raw:</span> {rawOldSpool !== null && Number.isFinite(rawOldSpool) ? distanceLabel(rawOldSpool) : '-'}</div>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>NEW raw:</span> {rawNewSpool !== null && Number.isFinite(rawNewSpool) ? distanceLabel(rawNewSpool) : '-'}</div>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>LD:</span> <strong style={{ color: lengthDifference !== null && lengthDifference <= 0.5 ? '#15803d' : '#b45309' }}>{lengthDifference !== null ? distanceLabel(lengthDifference) : '-'}</strong></div>
            <div><span style={{color: 'var(--color-gw-muted, #666)', fontWeight: 400}}>Master:</span> {masterOldSpool !== null && masterNewSpool !== null && Number.isFinite(masterOldSpool) && Number.isFinite(masterNewSpool) ? `${distanceLabel(masterOldSpool)} / ${distanceLabel(masterNewSpool)}` : '-'}</div>
          </div>
          <button onClick={() => setPreviousSelectedId('')} style={{background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, padding: 0, fontSize: '1.2rem'}} aria-label="Close measurement">✕</button>
        </div>
      )}
      <div className="gw-pipeline-overview">
        <div className="gw-pipeline-overview__track" aria-hidden="true">
          {matches.map((match, index) => {
            const position = Number(match.newVal ?? match.oldVal);
            if (!Number.isFinite(position)) return null;
            return <i key={String(match.id ?? index)} className={`is-${statusFor(match)}`} style={{ insetInlineStart: `${distancePercent(position, domain)}%` }} />;
          })}
          <span className="gw-pipeline-overview__window" style={{ insetInlineStart: `${viewport.leftPercent}%`, width: `${viewport.widthPercent}%` }} />
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={viewport.leftPercent + viewport.widthPercent / 2}
          disabled={viewport.widthPercent >= 99.9}
          aria-label="Timeline viewport position"
          onChange={(event) => panTo(Number(event.target.value))}
        />
      </div>

      <div ref={scrollRef} className="gw-pipeline-scroll" onScroll={updateViewport}>
        <div className="gw-pipeline-canvas" style={{ width: contentWidth }}>
          <div className="gw-pipeline-axis" aria-hidden="true">
            {axisTicks.map((tick) => <span key={tick} style={{ insetInlineStart: `${distancePercent(tick, domain)}%` }}>{distanceLabel(tick)}</span>)}
          </div>

          <div className="gw-pipeline-row is-new" aria-label={newRunLabel}>
            <strong>{newRunLabel}</strong>
            <div className="gw-pipeline-track" style={coverageStyle(timeline.newCoverage)} aria-hidden="true" />
            <FeatureMarkers values={timeline.newValves} type="valve" domain={domain} />
            <FeatureMarkers values={timeline.newTees} type="tee" domain={domain} />
            {newGwFeatures.map((feature, index) => {
              const position = feature.displayDistanceM;
              const match = (feature.id != null ? matchByNewId.get(String(feature.id)) : undefined)
                ?? matchForFeature(matches, feature, 'new');
              const status = match ? statusFor(match) : 'missing';
              return <TrackMarker key={`new-${String(feature.id ?? position)}-${index}`} position={position} sourcePosition={feature.sourceDistanceM} domain={domain} match={match} side="new" status={status} selected={Boolean(match && String(match.id) === selectedId)} onSelect={onSelectMatch} />;
            })}
          </div>

          <svg className="gw-pipeline-links" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
            {matches.map((match, index) => {
              const oldPosition = Number(match.oldVal);
              const newPosition = Number(match.newVal);
              if (!Number.isFinite(oldPosition) || !Number.isFinite(newPosition)) return null;
              const status = statusFor(match);
              if (status === 'missing') return null;
              const isSelected = String(match.id) === selectedId;
              return <line key={String(match.id ?? index)} className={`is-${status}${isSelected ? ' is-selected' : ''}`} x1={distancePercent(newPosition, domain) * 10} y1="105" x2={distancePercent(oldPosition, domain) * 10} y2="228" />;
            })}
          </svg>

          <div className="gw-pipeline-row is-old" aria-label={oldRunLabel}>
            <strong>{oldRunLabel}</strong>
            <div className="gw-pipeline-track" style={coverageStyle(timeline.oldCoverage)} aria-hidden="true" />
            <FeatureMarkers values={timeline.oldValves} type="valve" domain={domain} />
            <FeatureMarkers values={timeline.oldTees} type="tee" domain={domain} />
            {oldGwFeatures.map((feature, index) => {
              const position = feature.displayDistanceM;
              const match = (feature.id != null ? matchByOldId.get(String(feature.id)) : undefined)
                ?? matchForFeature(matches, feature, 'old');
              const status = match ? statusFor(match) : 'missing';
              return <TrackMarker key={`old-${String(feature.id ?? position)}-${index}`} position={position} sourcePosition={feature.sourceDistanceM} domain={domain} match={match} side="old" status={status} selected={Boolean(match && String(match.id) === selectedId)} onSelect={onSelectMatch} />;
            })}
          </div>

          {/* A degenerate domain means nothing ever populated the extent, so the
              matcher has not produced evidence.  A real domain with no matches
              is a genuine result — the runs were compared and nothing paired —
              and telling the operator to "run the matcher" there sends them to
              re-run a job that already completed. */}
          {!isLoading && matches.length === 0 && (
            domain.endM > domain.startM ? (
              <div className="gw-pipeline-empty" role="status">
                <strong>Matcher finished with no pairs</strong>
                <span>
                  Anchors from both runs were read, but none paired within the current tolerance.
                  Loosen the OTA, review the Tie-in setup result, or confirm both runs actually
                  cover the same pipeline segment.
                </span>
              </div>
            ) : (
              <div className="gw-pipeline-empty" role="status">
                <strong>No match evidence yet</strong>
                <span>Run the matcher or adjust the source inspections to populate this timeline.</span>
              </div>
            )
          )}
          {isLoading && <div className="gw-pipeline-loading" role="status" aria-live="polite"><span aria-hidden="true" />Updating alignment…</div>}
        </div>
      </div>
    </div>
  );
}
