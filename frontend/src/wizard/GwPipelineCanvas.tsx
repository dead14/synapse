import { useEffect, useMemo, useRef, useState } from 'react';

import {
  calculateViewportWindow,
  type GwTimelineMatch,
  type TimelineStatus,
} from '../domain/gwTimeline';

type ViewportWindow = ReturnType<typeof calculateViewportWindow>;

type Props = {
  matches: GwTimelineMatch[];
  oldGWs: number[];
  newGWs: number[];
  oldValves: number[];
  newValves: number[];
  oldTees: number[];
  newTees: number[];
  maxDistance: number;
  zoom: number;
  oldRunLabel: string;
  newRunLabel: string;
  selectedMatchId?: string | number;
  isLoading: boolean;
  statusFor: (match: GwTimelineMatch) => TimelineStatus;
  onSelectMatch: (match: GwTimelineMatch) => void;
};

const distanceLabel = (distance: number) => (
  Math.abs(distance) >= 1_000 ? `${(distance / 1_000).toFixed(2)} km` : `${distance.toFixed(0)} m`
);

const sameDistance = (left: unknown, right: number) => (
  Number.isFinite(Number(left)) && Math.abs(Number(left) - right) < 0.0005
);

function TrackMarker({
  position,
  maxDistance,
  match,
  status,
  selected,
  displayPosition,
  onSelect,
}: {
  position: number;
  maxDistance: number;
  match?: GwTimelineMatch;
  status: TimelineStatus;
  selected: boolean;
  displayPosition?: number | null;
  onSelect: (match: GwTimelineMatch) => void;
}) {
  const label = distanceLabel(Number.isFinite(Number(displayPosition)) ? Number(displayPosition) : position);
  const markerLabel = `${label} · ${status}${match ? ' pair' : ' feature'}`;

  return (
    <button
      type="button"
      className={`gw-pipeline-marker is-${status}${selected ? ' is-selected' : ''}`}
      style={{ insetInlineStart: `${Math.min(100, Math.max(0, (position / maxDistance) * 100))}%` }}
      disabled={!match}
      aria-label={markerLabel}
      aria-pressed={selected}
      onClick={() => match && onSelect(match)}
    >
      <span aria-hidden="true" />
      <small>{label}</small>
    </button>
  );
}

function FeatureMarkers({ values, type, maxDistance }: { values: number[]; type: 'valve' | 'tee'; maxDistance: number }) {
  return values.filter(Number.isFinite).map((position, index) => (
    <span
      key={`${type}-${position}-${index}`}
      className={`gw-pipeline-feature is-${type}`}
      style={{ insetInlineStart: `${Math.min(100, Math.max(0, (position / maxDistance) * 100))}%` }}
      title={`${type === 'valve' ? 'Valve' : 'Tee'} · ${distanceLabel(position)}`}
      aria-hidden="true"
    />
  ));
}

export default function GwPipelineCanvas({
  matches,
  oldGWs,
  newGWs,
  oldValves,
  newValves,
  oldTees,
  newTees,
  maxDistance,
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
  const safeMaximum = Math.max(1, maxDistance);
  const axisTicks = useMemo(() => Array.from({ length: 7 }, (_, index) => (safeMaximum / 6) * index), [safeMaximum]);

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

  return (
    <div className="gw-pipeline">
      <div className="gw-pipeline-overview">
        <div className="gw-pipeline-overview__track" aria-hidden="true">
          {matches.map((match, index) => {
            const position = Number(match.oldVal ?? match.newVal);
            if (!Number.isFinite(position)) return null;
            return <i key={String(match.id ?? index)} className={`is-${statusFor(match)}`} style={{ insetInlineStart: `${(position / safeMaximum) * 100}%` }} />;
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
            {axisTicks.map((tick) => <span key={tick} style={{ insetInlineStart: `${(tick / safeMaximum) * 100}%` }}>{distanceLabel(tick)}</span>)}
          </div>

          <div className="gw-pipeline-row is-old" aria-label={oldRunLabel}>
            <strong>{oldRunLabel}</strong>
            <div className="gw-pipeline-track" aria-hidden="true" />
            <FeatureMarkers values={oldValves} type="valve" maxDistance={safeMaximum} />
            <FeatureMarkers values={oldTees} type="tee" maxDistance={safeMaximum} />
            {oldGWs.filter(Number.isFinite).map((position, index) => {
              const match = matches.find((candidate) => sameDistance(candidate.oldVal, position));
              const status = match ? statusFor(match) : 'missing';
              return <TrackMarker key={`old-${position}-${index}`} position={position} maxDistance={safeMaximum} match={match} status={status} selected={Boolean(match && String(match.id) === selectedId)} onSelect={onSelectMatch} />;
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
              return <line key={String(match.id ?? index)} className={`is-${status}${isSelected ? ' is-selected' : ''}`} x1={(oldPosition / safeMaximum) * 1000} y1="105" x2={(newPosition / safeMaximum) * 1000} y2="228" />;
            })}
          </svg>

          <div className="gw-pipeline-row is-new" aria-label={newRunLabel}>
            <strong>{newRunLabel}</strong>
            <div className="gw-pipeline-track" aria-hidden="true" />
            <FeatureMarkers values={newValves} type="valve" maxDistance={safeMaximum} />
            <FeatureMarkers values={newTees} type="tee" maxDistance={safeMaximum} />
            {newGWs.filter(Number.isFinite).map((position, index) => {
              const match = matches.find((candidate) => sameDistance(candidate.newVal, position));
              const status = match ? statusFor(match) : 'missing';
              return <TrackMarker key={`new-${position}-${index}`} position={position} maxDistance={safeMaximum} displayPosition={match?.originalNewVal} match={match} status={status} selected={Boolean(match && String(match.id) === selectedId)} onSelect={onSelectMatch} />;
            })}
          </div>

          {!isLoading && matches.length === 0 && (
            <div className="gw-pipeline-empty" role="status"><strong>No match evidence yet</strong><span>Run the matcher or adjust the source inspections to populate this timeline.</span></div>
          )}
          {isLoading && <div className="gw-pipeline-loading" role="status" aria-live="polite"><span aria-hidden="true" />Updating alignment…</div>}
        </div>
      </div>
    </div>
  );
}
