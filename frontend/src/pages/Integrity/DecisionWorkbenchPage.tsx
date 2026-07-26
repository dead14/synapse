import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FiArrowRight, FiCheckCircle, FiPlus, FiRefreshCw } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { apiFetch } from '../../utils/api';

const stages = ['import', 'validate', 'align', 'assess', 'decide', 'repair', 'verify'] as const;
type Stage = typeof stages[number];
type IntegrityCaseRow = {
  id: number;
  anomaly_key: string;
  title: string;
  stage: Stage;
  response_category: string | null;
  data_quality_confidence: number | null;
  due_at: string | null;
};

export default function DecisionWorkbenchPage() {
  const [items, setItems] = useState<IntegrityCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [anomalyKey, setAnomalyKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ items: IntegrityCaseRow[] }>('/api/integrity-cases');
      setItems(response.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Integrity cases could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createCase = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/integrity-cases', {
        method: 'POST',
        body: {
          title, anomalyKey, dataQualityConfidence: 0.5,
          responseCategory: 'engineering_review',
          methodMetadata: { source: 'decision-workbench', validationStatus: 'awaiting-assessment' },
        },
      });
      setTitle('');
      setAnomalyKey('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Integrity case could not be created');
    }
  };

  const advance = async (item: IntegrityCaseRow) => {
    const next = stages[stages.indexOf(item.stage) + 1];
    if (!next) return;
    setBusyId(item.id);
    setError(null);
    try {
      await apiFetch(`/api/integrity-cases/${item.id}/stage`, { method: 'PATCH', body: { stage: next } });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Case stage could not be advanced');
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (item: IntegrityCaseRow) => {
    setBusyId(item.id);
    setError(null);
    try {
      await apiFetch(`/api/integrity-cases/${item.id}/approvals`, {
        method: 'POST',
        body: { decision: 'approved', reason: 'Assessment basis reviewed and approved for repair planning.' },
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Approval could not be recorded');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="syn-page">
      <PageMeta title="Integrity Decision Workbench · Synapse" description="Import through verified close-out" />
      <div className="syn-shell">
        <header className="syn-page__header">
          <div><p className="syn-eyebrow">Integrity execution core</p><h1 className="syn-page__title">Decision Workbench</h1><p className="syn-page__subtitle">Import → Validate → Align → Assess → Decide → Repair → Verify, with persistent ownership and approval gates.</p></div>
          <button className="syn-action syn-action--outline" type="button" onClick={() => void load()}><FiRefreshCw aria-hidden="true" />Refresh</button>
        </header>

        {error && <div className="syn-alert syn-alert--danger" role="alert"><div><span>{error}</span></div></div>}

        <form className="syn-panel mb-4 grid gap-3 p-5 md:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => void createCase(event)}>
          <label className="grid gap-2 text-sm font-medium">Anomaly key<input required value={anomalyKey} onChange={(event) => setAnomalyKey(event.target.value)} placeholder="run-2026:feature-1042" /></label>
          <label className="grid gap-2 text-sm font-medium">Case title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="External metal loss at KP 12+440" /></label>
          <button className="syn-action syn-action--ink self-end" type="submit"><FiPlus aria-hidden="true" />Create case</button>
        </form>

        <section className="syn-panel overflow-hidden">
          <div className="syn-table-wrap">
            <table className="syn-table">
              <thead><tr><th>Case</th><th>Response</th><th>Confidence</th><th>Workflow</th><th>Action</th></tr></thead>
              <tbody>
                {items.map((item) => {
                  const index = stages.indexOf(item.stage);
                  const next = stages[index + 1];
                  return <tr key={item.id}>
                    <td><strong>{item.title}</strong><small>{item.anomaly_key}</small></td>
                    <td><span className="syn-pill syn-pill--warning"><span className="syn-dot" />{item.response_category ?? 'not classified'}</span></td>
                    <td className="syn-data">{item.data_quality_confidence == null ? 'Unavailable' : `${Math.round(item.data_quality_confidence * 100)}%`}</td>
                    <td><div className="flex min-w-80 gap-1">{stages.map((stage, stageIndex) => <span key={stage} title={stage} className={`h-2 flex-1 rounded-full ${stageIndex <= index ? 'bg-brand-500' : 'bg-gray-200 dark:bg-gray-700'}`} />)}</div><small>{item.stage}</small></td>
                    <td>{next ? <div className="flex gap-2">{item.stage === 'decide' && <button disabled={busyId === item.id} className="syn-action syn-action--outline" type="button" onClick={() => void approve(item)}>Record independent approval</button>}<button disabled={busyId === item.id} className="syn-action syn-action--outline" type="button" onClick={() => void advance(item)}>Advance to {next}<FiArrowRight aria-hidden="true" /></button></div> : <span className="syn-pill syn-pill--signal"><FiCheckCircle aria-hidden="true" />Verified</span>}</td>
                  </tr>;
                })}
                {!loading && items.length === 0 && <tr><td colSpan={5}><div className="syn-empty-table"><strong>No integrity cases</strong><span>Create a case from an anomaly to begin the controlled decision workflow.</span></div></td></tr>}
                {loading && <tr><td colSpan={5}><div className="syn-table-loading"><span className="syn-skeleton" /><span className="syn-skeleton" /></div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
