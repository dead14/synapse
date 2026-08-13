import {
  FiAlertTriangle,
  FiCheckCircle,
  FiChevronRight,
  FiHelpCircle,
  FiXCircle,
} from 'react-icons/fi';

import { TIMELINE_STATUS_LABEL, type TimelineStatus, type TimelineSummary } from '../domain/gwTimeline';

type HistogramBin = {
  from: number;
  to: number;
  count: number;
};

export default function GwMatchHealthRail({
  summary,
  histogram,
  onOpenStatus,
}: {
  summary: TimelineSummary;
  histogram: HistogramBin[];
  onOpenStatus: (status: TimelineStatus) => void;
}) {
  const maximumBin = Math.max(1, ...histogram.map((bin) => bin.count));
  const rows: Array<{
    status: TimelineStatus;
    label: string;
    count: number;
    Icon: typeof FiCheckCircle;
  }> = [
    { status: 'review', label: 'Review queue', count: summary.review, Icon: FiAlertTriangle },
    { status: 'missing', label: TIMELINE_STATUS_LABEL.missing, count: summary.missing, Icon: FiXCircle },
    { status: 'matched', label: TIMELINE_STATUS_LABEL.matched, count: summary.matched, Icon: FiCheckCircle },
  ];

  return (
    <aside className="gw-health" aria-label="GW matching health">
      <section className="gw-health__score" aria-labelledby="gw-health-title">
        <header>
          <h3 id="gw-health-title">Match health</h3>
          <FiHelpCircle title="Accepted canonical pairs divided by all matcher outcomes" aria-label="Accepted canonical pairs divided by all matcher outcomes" />
        </header>
        <div className="gw-health-ring" role="img" aria-label={`${summary.matchedPercent.toFixed(1)} percent matched`}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="gw-health-ring__track" cx="60" cy="60" r="48" pathLength="100" />
            <circle className="gw-health-ring__value" cx="60" cy="60" r="48" pathLength="100" strokeDasharray={`${summary.matchedPercent} ${100 - summary.matchedPercent}`} />
          </svg>
          <strong>{summary.matchedPercent.toFixed(1)}%</strong>
          <span>Matched</span>
        </div>

        <div className="gw-health__rows">
          {rows.map(({ status, label, count, Icon }) => (
            <button key={status} type="button" className={`is-${status}`} disabled={count === 0} onClick={() => onOpenStatus(status)}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <strong>{count}</strong>
              <FiChevronRight aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className="gw-health__distribution" aria-labelledby="gw-offset-title">
        <header>
          <div>
            <h3 id="gw-offset-title">Offset distribution (m)</h3>
            <p>Based on matched and review pairs</p>
          </div>
          <FiHelpCircle title="Finite matcher offsets grouped into a symmetric range" aria-label="Finite matcher offsets grouped into a symmetric range" />
        </header>
        <div className="gw-histogram" role="img" aria-label={`Offset histogram with ${histogram.length} bins`}>
          <div className="gw-histogram__bars" aria-hidden="true">
            {histogram.map((bin, index) => (
              <i key={`${bin.from}-${bin.to}`} className={index === Math.floor(histogram.length / 2) ? 'is-zero' : ''} style={{ height: `${Math.max(3, (bin.count / maximumBin) * 100)}%` }} />
            ))}
          </div>
          <div className="gw-histogram__axis" aria-hidden="true"><span>{histogram[0]?.from.toFixed(0) ?? '−'}</span><span>0</span><span>{histogram.at(-1)?.to.toFixed(0) ?? '−'}</span></div>
        </div>
        <dl className="gw-health__metrics">
          <div><dt>mean</dt><dd>{summary.meanOffset.toFixed(2)}m</dd></div>
          <div><dt>max</dt><dd>{summary.maxOffset.toFixed(2)}m</dd></div>
        </dl>
      </section>
    </aside>
  );
}
