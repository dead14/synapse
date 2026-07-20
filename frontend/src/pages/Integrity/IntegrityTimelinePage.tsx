import { useMemo, useState } from 'react';
import { FiAlertTriangle, FiGitMerge, FiUpload } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import {
  buildIntegrityTimeline,
  type IntegrityTimeline,
  type TimelineObservation,
} from '../../lib/timeline/integrityTimeline';

function percentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function IntegrityTimelinePage() {
  const [timeline, setTimeline] = useState<IntegrityTimeline>({ runIds: [], genealogies: [] });
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => ({
    matched: timeline.genealogies.filter((item) => item.status === 'matched').length,
    exceptions: timeline.genealogies.filter((item) => item.status !== 'matched').length,
    review: timeline.genealogies.filter((item) => item.confidence.overall < 0.7 || item.status !== 'matched').length,
  }), [timeline]);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('Timeline file must contain an array of observations');
      setTimeline(buildIntegrityTimeline(parsed as TimelineObservation[]));
    } catch (caughtError) {
      setTimeline({ runIds: [], genealogies: [] });
      setError(caughtError instanceof Error ? caughtError.message : 'Timeline file could not be read');
    }
  };

  return (
    <div className="syn-page">
      <PageMeta title="Polyginesis Timeline · Synapse" description="Multi-run anomaly genealogy and growth confidence" />
      <div className="syn-shell">
        <header className="syn-page__header">
          <div>
            <p className="syn-eyebrow">Polyginesis · flagship workflow</p>
            <h1 className="syn-page__title">Multi-Run Integrity Timeline</h1>
            <p className="syn-page__subtitle">Trace anomaly identity, explain matching, quantify growth, expose uncertainty, and route exceptions to human review.</p>
          </div>
          <label className="syn-action syn-action--ink cursor-pointer">
            <FiUpload aria-hidden="true" />Load observations
            <input className="sr-only" type="file" accept=".json,application/json" onChange={(event) => void loadFile(event.target.files?.[0])} />
          </label>
        </header>

        {error && <div className="syn-alert syn-alert--danger" role="alert"><div><FiAlertTriangle aria-hidden="true" /><span>{error}</span></div></div>}

        <section className="grid gap-4 md:grid-cols-3">
          <article className="syn-panel p-5"><p className="syn-kicker">Genealogies</p><strong className="syn-data mt-3 block text-3xl">{timeline.genealogies.length}</strong><small className="text-gray-500">{timeline.runIds.length} chronological runs</small></article>
          <article className="syn-panel p-5"><p className="syn-kicker">Matched histories</p><strong className="syn-data mt-3 block text-3xl">{summary.matched}</strong><small className="text-gray-500">One identity across multiple observations</small></article>
          <article className="syn-panel p-5"><p className="syn-kicker">Exception review</p><strong className="syn-data mt-3 block text-3xl">{summary.review}</strong><small className="text-gray-500">{summary.exceptions} new, disappeared, split, merge, or overridden</small></article>
        </section>

        <section className="syn-panel mt-4 overflow-hidden">
          <header className="syn-section-heading">
            <div><p className="syn-kicker">Genealogy register</p><h2 className="syn-heading">Identity, growth, and confidence</h2></div>
          </header>
          <div className="syn-table-wrap">
            <table className="syn-table">
              <thead><tr><th>Genealogy</th><th>Status</th><th>Runs</th><th>Depth growth</th><th>Confidence</th><th>Review basis</th></tr></thead>
              <tbody>
                {timeline.genealogies.map((item) => (
                  <tr key={item.genealogyKey}>
                    <td><strong>{item.genealogyKey}</strong><small>Latest chainage {item.observations.at(-1)?.chainageM.toFixed(2)} m</small></td>
                    <td><span className={item.status === 'matched' ? 'syn-pill syn-pill--signal' : 'syn-pill syn-pill--warning'}><span className="syn-dot" />{item.status}</span></td>
                    <td className="syn-data">{item.observations.length}</td>
                    <td className="syn-data">{item.growth ? `${item.growth.depthPctDelta.toFixed(2)}% · ${item.growth.depthPctPerYear.toFixed(2)}%/y` : 'Not measurable'}</td>
                    <td><strong>{percentage(item.confidence.overall)}</strong><small>A {percentage(item.confidence.alignment)} · M {percentage(item.confidence.match)} · T {percentage(item.confidence.measurement)}</small></td>
                    <td><small>{item.status !== 'matched' ? 'Genealogy exception requires disposition' : item.confidence.overall < 0.7 ? 'Low-confidence match' : 'Evidence supports match'}</small></td>
                  </tr>
                ))}
                {timeline.genealogies.length === 0 && (
                  <tr><td colSpan={6}><div className="syn-empty-table" role="status"><FiGitMerge aria-hidden="true" /><strong>No multi-run observations loaded</strong><span>Load canonical observation JSON containing run, feature, genealogy, measurement tolerance, alignment confidence, and match confidence fields.</span></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
