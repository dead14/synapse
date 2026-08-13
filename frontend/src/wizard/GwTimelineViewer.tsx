import { useCallback, useMemo } from 'react';
import { FiMaximize, FiMinus, FiPlus } from 'react-icons/fi';

import type { GwReviewDecision, GwReviewDisposition } from '../domain/alignmentReview';
import {
  buildOffsetHistogram,
  buildTimelineSummary,
  classifyTimelineMatch,
  TIMELINE_STATUS_LABEL,
  type GwTimelineMatch,
  type TimelineGeometry,
  type TimelineStatus,
} from '../domain/gwTimeline';
import GwMatchHealthRail from './GwMatchHealthRail';
import GwPipelineCanvas from './GwPipelineCanvas';
import GwReviewPanel from './GwReviewPanel';

type Props = {
  matches: GwTimelineMatch[];
  dispositionsById: Record<string, GwReviewDisposition>;
  timeline: TimelineGeometry;
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
  timeline,
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
  const masterLength = Math.max(0, timeline.domain.endM - timeline.domain.startM);
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
          <h2 id="gw-timeline-title">Alignment viewer</h2>
          <p>
            {(masterLength / 1_000).toFixed(2)} km on the aligned axis · {oldRunLabel} projected onto {newRunLabel}
          </p>
        </div>
        <div className="gw-timeline-viewer__legend" aria-label="Marker legend">
          <span className="is-matched">{TIMELINE_STATUS_LABEL.matched}</span>
          <span className="is-review">{TIMELINE_STATUS_LABEL.review}</span>
          <span className="is-missing">{TIMELINE_STATUS_LABEL.missing}</span>
          <span className="is-feature">Valve / tee</span>
          <span className="is-link">Pair link</span>
        </div>
        <div className="gw-timeline-viewer__tools">
          <button
            type="button"
            className="gw-zoom-fit"
            onClick={() => onZoomChange(100)}
            disabled={zoom === 100}
            title="Fit the whole run in the viewport"
          >
            <FiMaximize aria-hidden="true" /> Fit
          </button>
          <div className="gw-zoom-control" role="group" aria-label="Timeline zoom">
            <button type="button" onClick={() => onZoomChange(clampZoom(zoom - 50))} disabled={zoom <= 100} aria-label="Zoom out"><FiMinus aria-hidden="true" /></button>
            {/* The multiplier, not the raw percentage: the range runs to 10 000 %
                and "10000" read as a distance rather than as a zoom level. */}
            <output className="gw-zoom-control__value">{(zoom / 100).toFixed(zoom < 1_000 ? 1 : 0)}×</output>
            <button type="button" onClick={() => onZoomChange(clampZoom(zoom + 50))} disabled={zoom >= 10000} aria-label="Zoom in"><FiPlus aria-hidden="true" /></button>
          </div>
          <input
            className="gw-zoom-slider"
            type="range"
            min="100"
            max="10000"
            step="25"
            value={zoom}
            onChange={(event) => onZoomChange(clampZoom(Number(event.target.value)))}
            aria-label="Timeline zoom level"
          />
        </div>
      </header>

      <div className="gw-timeline-viewer__stats" aria-label="Match summary">
        <span className="is-matched"><strong>{summary.matched}</strong> {TIMELINE_STATUS_LABEL.matched.toLowerCase()}</span>
        <span className="is-review"><strong>{summary.review}</strong> {TIMELINE_STATUS_LABEL.review.toLowerCase()}</span>
        <span className="is-missing"><strong>{summary.missing}</strong> not matched</span>
        <span className="is-offset"><strong>{summary.meanOffset.toFixed(2)} m</strong> mean offset</span>
        <span><strong>{summary.maxOffset.toFixed(2)} m</strong> max offset</span>
      </div>

      <div className="gw-timeline-viewer__grid">
        <div className="gw-timeline-viewer__main">
          <GwPipelineCanvas
            matches={matches}
            timeline={timeline}
            zoom={zoom}
            oldRunLabel={oldRunLabel}
            newRunLabel={newRunLabel}
            selectedMatchId={selectedMatch?.id}
            isLoading={isLoading}
            statusFor={statusFor}
            onSelectMatch={onSelectMatch}
          />
        </div>
        <GwMatchHealthRail summary={summary} histogram={histogram} onOpenStatus={openStatus} />
      </div>

      {selectedMatch && selectedDecision ? (
        <GwReviewPanel
          match={selectedMatch}
          decision={selectedDecision}
          oldRunLabel={oldRunLabel}
          newRunLabel={newRunLabel}
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
