import { FiAlertTriangle, FiCheckCircle, FiFileText, FiX, FiXCircle } from 'react-icons/fi';

import type { GwReviewDecision, GwReviewDisposition } from '../domain/alignmentReview';
import { readMatchConfidence, type GwTimelineMatch } from '../domain/gwTimeline';

const options: Array<{ value: GwReviewDisposition; label: string; Icon: typeof FiCheckCircle }> = [
  { value: 'accepted', label: 'Accept', Icon: FiCheckCircle },
  { value: 'review', label: 'Review', Icon: FiAlertTriangle },
  { value: 'excluded', label: 'Exclude', Icon: FiXCircle },
];

function distance(value: number | null) {
  return value === null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(3)} m`;
}

function chainage(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return '—';
  const numericDistance = Number(value);
  return Math.abs(numericDistance) >= 1_000
    ? `${(numericDistance / 1_000).toFixed(3)} km`
    : `${numericDistance.toFixed(3)} m`;
}

function offset(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? distance(Number(value)) : '—';
}

export default function GwReviewPanel({
  match,
  decision,
  onClose,
  onDisposition,
  onNote,
  canReview,
}: {
  match: GwTimelineMatch;
  decision: GwReviewDecision;
  onClose: () => void;
  onDisposition: (value: GwReviewDisposition) => void;
  onNote: (value: string) => void;
  canReview: boolean;
}) {
  const confidence = readMatchConfidence(match);
  const pairId = match.oldId !== null && match.oldId !== undefined && match.newId !== null && match.newId !== undefined
    ? `${match.oldId} ↔ ${match.newId}`
    : String(match.id ?? 'Pair ID unavailable');
  const delta = Number.isFinite(Number(match.oldVal)) && Number.isFinite(Number(match.originalNewVal))
    ? Number(match.originalNewVal) - Number(match.oldVal)
    : null;
  const statusLabel = decision.disposition === 'accepted'
    ? 'Matched'
    : decision.disposition === 'review' ? 'Review' : 'Missing';

  return (
    <section className="gw-pair-details" aria-labelledby="gw-pair-details-title">
      <header className="gw-pair-details__header">
        <div className="gw-pair-details__identity">
          <h3 id="gw-pair-details-title">Pair details</h3>
          <span>{chainage(match.oldVal)}</span>
          <small>Pair ID: {pairId}</small>
        </div>
        <span className={`gw-pair-status is-${decision.disposition}`}>{statusLabel}</span>
        <button type="button" onClick={onClose} aria-label="Clear selected pair"><FiX aria-hidden="true" /></button>
      </header>
      <div className="gw-pair-details__grid">
        <dl>
          <div className="gw-pair-details__group-title"><dt>Historical OLD</dt><dd>{match.oldDesc || 'Feature description unavailable'}</dd></div>
          <div><dt>Feature ID</dt><dd>{match.oldId ?? '—'}</dd></div>
          <div><dt>Distance</dt><dd>{chainage(match.oldVal)}</dd></div>
        </dl>
        <dl>
          <div className="gw-pair-details__group-title"><dt>Master NEW</dt><dd>{match.newDesc || 'Feature description unavailable'}</dd></div>
          <div><dt>Feature ID</dt><dd>{match.newId ?? '—'}</dd></div>
          <div><dt>Distance</dt><dd>{chainage(match.originalNewVal)}</dd></div>
        </dl>
        <dl>
          <div className="gw-pair-details__group-title"><dt>Comparison</dt><dd>{match.flagged ? 'High deviation' : match.status === 'Skipped' ? 'Missing side' : 'Canonical pair'}</dd></div>
          <div><dt>Delta</dt><dd>{offset(delta)}</dd></div>
          <div><dt>Offset</dt><dd>{offset(match.offset)}</dd></div>
          <div><dt>Confidence</dt><dd>{confidence === null ? '—' : `${confidence.toFixed(1)}%`}</dd></div>
        </dl>
        <div className="gw-pair-details__review">
          <span>Review disposition</span>
          <div className="gw-review-decision__actions" aria-label="Review disposition">
            {options.map(({ value, label, Icon }) => (
              <button key={value} type="button" disabled={!canReview} aria-pressed={decision.disposition === value} className={decision.disposition === value ? `is-${value}` : ''} onClick={() => onDisposition(value)}>
                <Icon aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="gw-pair-details__note">
        <span><FiFileText aria-hidden="true" />Review note</span>
        <textarea value={decision.note} maxLength={500} disabled={!canReview} onChange={(event) => onNote(event.target.value)} placeholder="State the evidence for this decision" />
        <small>{canReview ? `${decision.note.length} / 500 · saved with the session when you continue` : 'Only a matched canonical pair can be reviewed as a sectioning lock.'}</small>
      </label>
      {decision.disposition === 'excluded' && <p className="gw-review-decision__warning"><FiAlertTriangle aria-hidden="true" />This pair will not be sent as a sectioning lock.</p>}
    </section>
  );
}
