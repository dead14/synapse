import { FiActivity, FiArrowUpRight, FiCheckCircle, FiUser } from 'react-icons/fi';
import { Link } from 'react-router-dom';

import { deriveNextAction, type DashboardStats } from '../../domain/dashboard';

type Viewer = { username: string; email: string } | null;

function formatDate(value: string | null) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function responseLabel(value: string | null) {
  if (!value) return 'Not classified';
  return value.replaceAll('_', ' ');
}

function stageLabel(value: string) {
  return value.replaceAll('_', ' ');
}

export default function DashboardFindings({ stats, loading, user }: { stats: DashboardStats; loading: boolean; user: Viewer }) {
  const action = deriveNextAction(stats);
  const findings = stats.overview.recentFindings;

  return (
    <section className="integrity-findings" aria-label="Integrity case overview">
      <article className="syn-panel integrity-findings__table-panel">
        <header className="integrity-panel-heading">
          <div><p className="syn-kicker">Priority-adjusted case register</p><h2 className="syn-heading">Integrity cases</h2></div>
          <Link to="/integrity-workbench" className="integrity-text-link">Open workbench <FiArrowUpRight aria-hidden="true" /></Link>
        </header>
        <div className="syn-table-wrap">
          <table className="syn-table integrity-findings__table">
            <thead><tr><th scope="col">Case</th><th scope="col">Response</th><th scope="col">Stage</th><th scope="col">Owner</th><th scope="col">Due</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5}><div className="syn-table-loading" aria-label="Loading integrity cases"><span className="syn-skeleton" /><span className="syn-skeleton" /><span className="syn-skeleton" /></div></td></tr>}
              {!loading && findings.length === 0 && <tr><td colSpan={5}><div className="syn-empty-table" role="status"><FiActivity aria-hidden="true" /><strong>No integrity cases are available</strong><span>Create or import case evidence to populate the operational register.</span></div></td></tr>}
              {!loading && findings.map((finding) => <tr key={finding.id}><td><strong>{finding.anomalyKey}</strong><small>{finding.title}</small></td><td><span className={`integrity-response integrity-response--${finding.responseCategory ?? 'unclassified'}`}>{responseLabel(finding.responseCategory)}</span></td><td>{stageLabel(finding.stage)}</td><td>{finding.owner ?? 'Unassigned'}</td><td>{formatDate(finding.dueAt)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </article>

      <aside className="syn-panel integrity-case-focus">
        <span className="integrity-case-focus__icon"><FiCheckCircle aria-hidden="true" /></span>
        <p className="syn-kicker">Next engineering action</p>
        <h2 className="syn-heading">{action.label}</h2>
        <p>{action.description}</p>
        <Link to={action.path} className="syn-action syn-action--ink">Open workflow <FiArrowUpRight aria-hidden="true" /></Link>
        <div className="integrity-case-focus__viewer"><FiUser aria-hidden="true" /><div><strong>{user?.username ?? 'Current user'}</strong><span>{user?.email ?? 'Authenticated workspace'}</span></div></div>
      </aside>
    </section>
  );
}
