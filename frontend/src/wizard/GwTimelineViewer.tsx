import { useCallback, useMemo } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';

import type { GwReviewDecision, GwReviewDisposition } from '../domain/alignmentReview';
import {
  buildOffsetHistogram,
  buildTimelineSummary,
  classifyTimelineMatch,
  type GwTimelineMatch,
  type TimelineStatus,
} from '../domain/gwTimeline';
import GwMatchHealthRail from './GwMatchHealthRail';
import GwPipelineCanvas from './GwPipelineCanvas';
import GwReviewPanel from './GwReviewPanel';

type Props = {
  matches: GwTimelineMatch[];
  dispositionsById: Record<string, GwReviewDisposition>;
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
  selectedMatch: GwTimelineMatch | null;
  selectedDecision: GwReviewDecision | null;
  isLoading: boolean;
  canReviewSelected: boolean;
  onZoomChange: (zoom: number) => void;
  onSelectMatch: (match: GwTimelineMatch) => void;
  onClearSelection: () => void;
  onDisposition: (value: GwReviewDisposition) => void;
  onNote: (value: string) => void;
};

const clampZoom = (value: number) => Math.min(10000, Math.max(100, value));

export default function GwTimelineViewer({
  matches,
  dispositionsById,
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
  selectedMatch,
  selectedDecision,
  isLoading,
  canReviewSelected,
  onZoomChange,
  onSelectMatch,
  onClearSelection,
  onDisposition,
  onNote,
}: Props) {
  const summary = useMemo(
    () => buildTimelineSummary(matches, dispositionsById),
    [dispositionsById, matches],
  );
  const statusFor = useCallback(
    (match: GwTimelineMatch) => classifyTimelineMatch(
      match,
      match.id === undefined ? undefined : dispositionsById[String(match.id)],
    ),
    [dispositionsById],
  );
  const histogram = useMemo(() => buildOffsetHistogram(
    matches.filter((match) => statusFor(match) !== 'missing').map((match) => Number(match.offset)),
    18,
  ), [matches, statusFor]);

  const openStatus = (status: TimelineStatus) => {
    const firstMatch = matches.find((match) => statusFor(match) === status);
    if (firstMatch) onSelectMatch(firstMatch);
  };

  return (
    <section className="gw-timeline-viewer" aria-labelledby="gw-timeline-title">
      <header className="gw-timeline-viewer__header">
        <div className="gw-timeline-viewer__title">
          <h2 id="gw-timeline-title"><span>SYS /</span> Timeline Viewer</h2>
          <p>{(maxDistance / 1_000).toFixed(1)}+ km interactive pipeline alignment map</p>
        </div>
        <div className="gw-timeline-viewer__stats" aria-label="Match summary">
          <span className="is-matched">{summary.matched} matched</span>
          <span className="is-review">{summary.review} review</span>
          <span className="is-missing">{summary.missing} missing</span>
          <span className="is-offset">mean {summary.meanOffset.toFixed(2)}m</span>
          <span>max {summary.maxOffset.toFixed(2)}m</span>
        </div>
        <label className="gw-zoom-control">
          <span>Zoom</span>
          <button type="button" onClick={() => onZoomChange(clampZoom(zoom - 50))} disabled={zoom <= 100} aria-label="Zoom out"><FiMinus aria-hidden="true" /></button>
          <input type="range" min="100" max="10000" step="25" value={zoom} onChange={(event) => onZoomChange(clampZoom(Number(event.target.value)))} aria-label="Timeline zoom" />
          <button type="button" onClick={() => onZoomChange(clampZoom(zoom + 50))} disabled={zoom >= 10000} aria-label="Zoom in"><FiPlus aria-hidden="true" /></button>
        </label>
      </header>

      <div className="gw-timeline-viewer__grid">
        <div className="gw-timeline-viewer__main">
          <GwPipelineCanvas
            matches={matches}
            oldGWs={oldGWs}
            newGWs={newGWs}
            oldValves={oldValves}
            newValves={newValves}
            oldTees={oldTees}
            newTees={newTees}
            maxDistance={maxDistance}
            zoom={zoom}
            oldRunLabel={oldRunLabel}
            newRunLabel={newRunLabel}
            selectedMatchId={selectedMatch?.id}
            isLoading={isLoading}
            statusFor={statusFor}
            onSelectMatch={onSelectMatch}
          />
          <div className="gw-timeline-legend" aria-label="Timeline legend">
            <span className="is-matched">Matched</span>
            <span className="is-missing">Missing</span>
            <span className="is-review">Review</span>
            <span className="is-feature">Valve / Tee</span>
            <span className="is-link">Pair link</span>
          </div>
        </div>
        <GwMatchHealthRail summary={summary} histogram={histogram} onOpenStatus={openStatus} />
      </div>

      {selectedMatch && selectedDecision ? (
        <GwReviewPanel
          match={selectedMatch}
          decision={selectedDecision}
          onClose={onClearSelection}
          onDisposition={onDisposition}
          onNote={onNote}
          canReview={canReviewSelected}
        />
      ) : (
        <p className="gw-selection-hint" role="status">Select a weld marker, pair link, or health category to inspect its engineering evidence.</p>
      )}
    </section>
  );
}
