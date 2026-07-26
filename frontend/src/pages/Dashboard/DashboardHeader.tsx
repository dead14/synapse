import { type ComponentType } from 'react';
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowUpRight,
  FiDatabase,
  FiMap,
  FiRefreshCw,
  FiShield,
} from 'react-icons/fi';
import { Link } from 'react-router-dom';

import type { DashboardStats } from '../../domain/dashboard';

type MetricProps = {
  label: string;
  value: string;
  detail: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  tone: 'route' | 'active' | 'urgent' | 'confidence';
  loading: boolean;
};

function measuredLength(value: number | null) {
  return value === null ? 'Not measured' : `${(value / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} km`;
}

function measuredPercent(value: number | null) {
  return value === null ? 'Not measured' : `${value.toFixed(1)}%`;
}

function MetricCard({ label, value, detail, icon: Icon, tone, loading }: MetricProps) {
  return (
    <article className={`integrity-metric integrity-metric--${tone}`}>
      <span className="integrity-metric__icon"><Icon aria-hidden /></span>
      <div>
        <p>{label}</p>
        {loading ? <span className="syn-skeleton integrity-metric__skeleton" aria-label={`Loading ${label}`} /> : <strong>{value}</strong>}
        <small>{detail}</small>
      </div>
    </article>
  );
}

export default function DashboardHeader({
  stats,
  loading,
  onRefresh,
}: {
  stats: DashboardStats;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { primaryPipeline, metrics, latestRun } = stats.overview;
  const pipelineName = primaryPipeline.name ?? 'No measured pipeline selected';

  return (
    <>
      <header className="integrity-overview__heading">
        <div>
          <p className="syn-kicker">Integrity operations / live evidence</p>
          <h1 className="syn-display">ILI integrity dashboard.</h1>
          <p className="syn-copy">A measured view of inspection ingestion, case response, and latest-run depth distribution.</p>
        </div>
        <div className="integrity-overview__heading-actions">
          <button type="button" className="syn-action syn-action--outline" onClick={onRefresh} disabled={loading}>
            <FiRefreshCw aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link to="/runs" className="syn-action syn-action--ink">
            Import ILI data <FiArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="integrity-metrics" aria-label="Integrity operations summary">
        <MetricCard label="Measured corridor" value={measuredLength(primaryPipeline.measuredLengthM)} detail="Latest inspection of the selected pipeline" icon={FiMap} tone="route" loading={loading} />
        <MetricCard label="Active ingestion jobs" value={String(metrics.activeIngestionJobs)} detail="Queued or running across your organization" icon={FiActivity} tone="active" loading={loading} />
        <MetricCard label="Immediate response cases" value={String(metrics.criticalCases)} detail="Persisted cases marked for immediate response" icon={FiAlertTriangle} tone="urgent" loading={loading} />
        <MetricCard label="Case data quality" value={measuredPercent(metrics.dataQualityConfidencePct)} detail="Mean persisted case data-quality confidence" icon={FiShield} tone="confidence" loading={loading} />
      </section>

      <section className="integrity-pipeline-strip" aria-label="Selected pipeline context">
        <span className="integrity-pipeline-strip__icon"><FiDatabase aria-hidden="true" /></span>
        <div className="integrity-pipeline-strip__title">
          <p>Selected pipeline</p>
          <h2>{pipelineName}</h2>
        </div>
        <dl className="integrity-pipeline-strip__facts">
          <div><dt>Inspection runs</dt><dd>{primaryPipeline.runCount}</dd></div>
          <div><dt>Measured corridor</dt><dd>{measuredLength(primaryPipeline.measuredLengthM)}</dd></div>
          <div><dt>Latest run</dt><dd>{latestRun?.vendor ?? 'Not recorded'}{latestRun?.surveyYear ? ` · ${latestRun.surveyYear}` : ''}</dd></div>
        </dl>
      </section>
    </>
  );
}
