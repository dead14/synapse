import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FiCheckCircle, FiFilePlus, FiTool } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { apiFetch } from '../../utils/api';

type CaseRow = { id: number; title: string; anomaly_key: string; stage: string };
type RepairPlan = { id: number; repair_method: string; status: string; work_order_reference: string | null };
type Evidence = { id: number; evidence_type: string; status: string; source_reference: string | null };
type Bundle = { case: CaseRow; repairPlans: RepairPlan[]; evidence: Evidence[]; approvals: unknown[] };
const nextEvidence: Record<string, string | undefined> = {
  required: 'requested', requested: 'submitted', submitted: 'reviewed', reviewed: 'accepted',
  rejected: 'requested', accepted: 'superseded',
};

export default function RepairEvidencePage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairMethod, setRepairMethod] = useState('');
  const [engineeringBasis, setEngineeringBasis] = useState('');
  const [evidenceType, setEvidenceType] = useState('excavation-photo');
  const [sourceReference, setSourceReference] = useState('');

  const loadCases = useCallback(async () => {
    try {
      const response = await apiFetch<{ items: CaseRow[] }>('/api/integrity-cases');
      const repairCases = response.items.filter((item) => ['repair', 'verify'].includes(item.stage));
      setCases(repairCases);
      setSelectedId((current) => current ?? repairCases[0]?.id ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Repair cases could not be loaded'); }
  }, []);
  const loadBundle = useCallback(async (id: number) => {
    try { setBundle(await apiFetch<Bundle>(`/api/integrity-cases/${id}`)); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Repair case could not be loaded'); }
  }, []);
  useEffect(() => { void loadCases(); }, [loadCases]);
  useEffect(() => { if (selectedId) void loadBundle(selectedId); }, [selectedId, loadBundle]);

  const addPlan = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedId) return;
    try {
      await apiFetch(`/api/integrity-cases/${selectedId}/repair-plans`, {
        method: 'POST', body: { repairMethod, engineeringBasis, digSheet: { status: 'draft' } },
      });
      setRepairMethod(''); setEngineeringBasis(''); await loadBundle(selectedId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Repair plan could not be created'); }
  };
  const addEvidence = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedId) return;
    try {
      await apiFetch(`/api/integrity-cases/${selectedId}/evidence`, {
        method: 'POST', body: { evidenceType, sourceReference, repairPlanId: bundle?.repairPlans[0]?.id ?? null },
      });
      setSourceReference(''); await loadBundle(selectedId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Evidence could not be created'); }
  };
  const advanceEvidence = async (item: Evidence) => {
    const status = nextEvidence[item.status]; if (!status || !selectedId) return;
    try {
      await apiFetch(`/api/integrity-cases/evidence/${item.id}/status`, { method: 'PATCH', body: { status } });
      await loadBundle(selectedId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Evidence status could not be changed'); }
  };

  return <div className="syn-page syn-ui-kit"><PageMeta title="Repair & Evidence · Synapse" description="Repair plan, dig sheet, and close-out evidence" /><div className="syn-shell">
    <header className="syn-page__header"><div><p className="syn-eyebrow">Repair lifecycle</p><h1 className="syn-page__title">Repair & Evidence Workbench</h1><p className="syn-page__subtitle">Approved decision → repair plan → dig sheet → excavation/NDE → repair → accepted close-out evidence.</p></div></header>
    {error && <div className="syn-alert syn-alert--danger" role="alert"><div>{error}</div></div>}
    <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
      <aside className="syn-panel p-4"><p className="syn-kicker">Approved repair cases</p><div className="mt-3 grid gap-2">{cases.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`rounded-lg border p-3 text-left ${selectedId === item.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-gray-200 dark:border-gray-700'}`}><strong className="block text-sm">{item.title}</strong><small>{item.anomaly_key} · {item.stage}</small></button>)}{cases.length === 0 && <p className="text-sm text-gray-500">No case has reached repair stage.</p>}</div></aside>
      <main className="grid gap-4">
        <section className="grid gap-4 lg:grid-cols-2">
          <form className="syn-panel grid gap-3 p-5" onSubmit={(event) => void addPlan(event)}><p className="syn-kicker">Repair plan & dig sheet</p><input required value={repairMethod} onChange={(e) => setRepairMethod(e.target.value)} placeholder="Repair method" /><textarea required value={engineeringBasis} onChange={(e) => setEngineeringBasis(e.target.value)} placeholder="Engineering basis" /><button disabled={!selectedId} className="syn-action syn-action--ink" type="submit"><FiTool />Create plan</button></form>
          <form className="syn-panel grid gap-3 p-5" onSubmit={(event) => void addEvidence(event)}><p className="syn-kicker">Field evidence</p><select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}><option value="excavation-photo">Excavation photo</option><option value="nde-report">NDE report</option><option value="coating-condition">Coating condition</option><option value="gps-observation">GPS observation</option><option value="close-out-certificate">Close-out certificate</option></select><input required value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="Document or object reference" /><button disabled={!selectedId} className="syn-action syn-action--outline" type="submit"><FiFilePlus />Add evidence</button></form>
        </section>
        <section className="syn-panel overflow-hidden"><div className="syn-table-wrap"><table className="syn-table"><thead><tr><th>Evidence</th><th>Source</th><th>Status</th><th>Controlled action</th></tr></thead><tbody>
          {bundle?.evidence.map((item) => <tr key={item.id}><td><strong>{item.evidence_type}</strong></td><td>{item.source_reference ?? 'Not attached'}</td><td><span className={item.status === 'accepted' ? 'syn-pill syn-pill--signal' : 'syn-pill syn-pill--warning'}>{item.status}</span></td><td>{nextEvidence[item.status] ? <button className="syn-action syn-action--outline" onClick={() => void advanceEvidence(item)} type="button">Move to {nextEvidence[item.status]}</button> : <FiCheckCircle aria-label="Lifecycle complete" />}</td></tr>)}
          {!bundle?.evidence.length && <tr><td colSpan={4}><div className="syn-empty-table"><strong>No evidence records</strong><span>Create required field evidence and advance it through review before close-out.</span></div></td></tr>}
        </tbody></table></div></section>
      </main>
    </div>
  </div></div>;
}
