import type { CSSProperties } from 'react';
import { FiArrowUpRight, FiMapPin, FiNavigation, FiRadio } from 'react-icons/fi';
import { Link } from 'react-router-dom';

import type { DashboardOverview, DashboardSeverity } from '../../domain/dashboard';

function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatChainage(value: number) {
  return `${(value / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} km`;
}

function severityLabel(severity: DashboardSeverity) {
  return severity === 'none' ? 'No indication' : `${severity[0].toUpperCase()}${severity.slice(1)} depth band`;
}

function EmptyPanel({ children }: { children: string }) {
  return <div className="integrity-empty" role="status"><FiRadio aria-hidden="true" /><span>{children}</span></div>;
}

function DepthHeatmap({ overview, loading }: { overview: DashboardOverview; loading: boolean }) {
  return (
    <article className="syn-panel integrity-insight integrity-heatmap">
      <header className="integrity-panel-heading">
        <div><p className="syn-kicker">Latest run / visual triage only</p><h2 className="syn-heading">Anomaly depth distribution</h2></div>
        <span className="syn-pill">24 chainage buckets</span>
      </header>
      <p className="integrity-panel-copy">Colors sort maximum reported depth by feature type; they are not a risk classification or engineering disposition.</p>
      {loading ? <div className="integrity-heatmap__loading" aria-busy="true"><span className="syn-skeleton" /><span className="syn-skeleton" /><span className="syn-skeleton" /></div> : overview.heatmap.length === 0 ? <EmptyPanel>No valid latest-run depth distribution is available yet.</EmptyPanel> : (
        <div className="integrity-heatmap__grid" role="img" aria-label="Latest inspection depth distribution across chainage buckets">
          {overview.heatmap.map((row) => (
            <div className="integrity-heatmap__row" key={row.featureType}>
              <strong title={row.featureType}>{row.featureType}</strong>
              <div>{row.cells.map((cell) => <span key={cell.bucket} className={`integrity-heatmap__cell is-${cell.severity}`} title={`Bucket ${cell.bucket + 1}: ${severityLabel(cell.severity)}`} />)}</div>
            </div>
          ))}
        </div>
      )}
      <ul className="integrity-legend" aria-label="Depth band legend">
        {(['none', 'low', 'medium', 'high', 'critical'] as DashboardSeverity[]).map((severity) => <li key={severity}><i className={`is-${severity}`} />{severityLabel(severity)}</li>)}
      </ul>
    </article>
  );
}

function LatestRun({ overview, loading }: { overview: DashboardOverview; loading: boolean }) {
  const run = overview.latestRun;
  return (
    <article className="syn-panel integrity-insight integrity-latest-run">
      <header className="integrity-panel-heading">
        <div><p className="syn-kicker">Persisted inspection</p><h2 className="syn-heading">Latest ILI run</h2></div>
        <FiRadio aria-hidden="true" />
      </header>
      {loading ? <div className="integrity-run-skeleton" aria-busy="true"><span className="syn-skeleton" /><span className="syn-skeleton" /><span className="syn-skeleton" /></div> : !run ? <EmptyPanel>No inspection run has been imported for this pipeline.</EmptyPanel> : (
        <>
          <dl className="integrity-run-facts">
            <div><dt>Tool / vendor</dt><dd>{run.vendor ?? 'Not recorded'}</dd></div>
            <div><dt>Survey year</dt><dd>{run.surveyYear ?? 'Not recorded'}</dd></div>
            <div><dt>Features</dt><dd>{run.featureCount.toLocaleString('en-GB')}</dd></div>
            <div><dt>Uploaded</dt><dd>{formatDateTime(run.uploadedAt)}</dd></div>
          </dl>
          <Link to="/alignment-history" className="integrity-text-link">Open alignment registry <FiArrowUpRight aria-hidden="true" /></Link>
        </>
      )}
    </article>
  );
}

function Corridor({ overview, loading }: { overview: DashboardOverview; loading: boolean }) {
  const length = overview.primaryPipeline.measuredLengthM;
  return (
    <article className="syn-panel integrity-insight integrity-corridor">
      <header className="integrity-panel-heading">
        <div><p className="syn-kicker">Chainage schematic / not a map</p><h2 className="syn-heading">Measured pipeline corridor</h2></div>
        <FiNavigation aria-hidden="true" />
      </header>
      {loading ? <div className="integrity-corridor__loading" aria-busy="true"><span className="syn-skeleton" /></div> : length === null ? <EmptyPanel>Import a run with valid chainage to draw the measured corridor.</EmptyPanel> : (
        <>
          <div className="integrity-corridor__canvas" role="img" aria-label={`Measured corridor length ${formatChainage(length)}`}>
            <span className="integrity-corridor__terminal is-start">0 km</span>
            <span className="integrity-corridor__route" aria-hidden="true" />
            <span className="integrity-corridor__terminal is-end">{formatChainage(length)}</span>
            <ol className="integrity-corridor__markers">
              {overview.corridorMarkers.map((marker) => {
                const position = Math.min(100, Math.max(0, (marker.chainageM / length) * 100));
                return <li key={marker.id} className={`is-${marker.severity}`} style={{ '--marker-position': `${position}%` } as CSSProperties} aria-label={`${marker.featureType} at ${formatChainage(marker.chainageM)}, ${marker.severity} depth band`}><FiMapPin aria-hidden="true" /><span>{formatChainage(marker.chainageM)}</span></li>;
              })}
            </ol>
          </div>
          <p className="integrity-corridor__note">{overview.corridorMarkers.length ? 'Markers show up to five highest reported latest-run depth observations.' : 'No latest-run observations reached the visual depth-band threshold.'}</p>
        </>
      )}
    </article>
  );
}

export default function DashboardInsights({ overview, loading }: { overview: DashboardOverview; loading: boolean }) {
  return <section className="integrity-insights" aria-label="Inspection evidence overview"><DepthHeatmap overview={overview} loading={loading} /><LatestRun overview={overview} loading={loading} /><Corridor overview={overview} loading={loading} /></section>;
}
