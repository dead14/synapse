import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FiArrowRight, FiPlus } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { apiFetch } from '../../utils/api';
const phases = ['pre-assessment', 'indirect-inspection', 'direct-examination', 'post-assessment', 'reassessment'] as const;
type Project = { id: number; title: string; method: string; phase: typeof phases[number]; selection_basis: string };

export default function DirectAssessmentPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [form, setForm] = useState({ title: '', method: 'ECDA', selectionBasis: '' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setItems((await apiFetch<{ items: Project[] }>('/api/direct-assessments')).items); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Direct Assessment'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async (event: FormEvent) => { event.preventDefault(); try { await apiFetch('/api/direct-assessments', { method: 'POST', body: form }); setForm({ title: '', method: 'ECDA', selectionBasis: '' }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not create project'); } };
  const advance = async (item: Project) => { const phase = phases[phases.indexOf(item.phase) + 1]; if (!phase) return; try { await apiFetch(`/api/direct-assessments/${item.id}/phase`, { method: 'PATCH', body: { phase } }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not advance phase'); } };
  const addCp = async (item: Project) => { try { await apiFetch(`/api/direct-assessments/${item.id}/cp-surveys`, { method: 'POST', body: { surveyType: 'CIPS', surveyDate: new Date().toISOString().slice(0, 10), sourceReference: 'Pending controlled upload', readingCount: 0 } }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not add CP survey'); } };
  return <div className="syn-page syn-ui-kit"><PageMeta title="Direct Assessment & CP · Synapse" description="ECDA, ICDA, SCCDA and CP workflow" /><div className="syn-shell">
    <header className="syn-page__header"><div><p className="syn-eyebrow">Unpiggable pipeline integrity</p><h1 className="syn-page__title">Direct Assessment & CP</h1><p className="syn-page__subtitle">Pre-assessment → indirect inspection → direct examination → post-assessment → reassessment.</p></div></header>
    {error && <div className="syn-alert syn-alert--danger" role="alert"><div>{error}</div></div>}
    <form className="syn-panel mb-4 grid gap-3 p-5 md:grid-cols-3" onSubmit={(e) => void create(e)}><input required placeholder="Project title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option>ECDA</option><option>ICDA</option><option>SCCDA</option><option>CDA</option></select><input required placeholder="Selection basis" value={form.selectionBasis} onChange={(e) => setForm({ ...form, selectionBasis: e.target.value })} /><button className="syn-action syn-action--ink md:col-span-3"><FiPlus />Create assessment</button></form>
    <section className="syn-panel overflow-hidden"><div className="syn-table-wrap"><table className="syn-table"><thead><tr><th>Assessment</th><th>Method</th><th>Phase</th><th>Actions</th></tr></thead><tbody>{items.map((item) => { const next = phases[phases.indexOf(item.phase) + 1]; return <tr key={item.id}><td><strong>{item.title}</strong><small>{item.selection_basis}</small></td><td>{item.method}</td><td><span className="syn-pill syn-pill--warning">{item.phase}</span></td><td><div className="flex gap-2"><button type="button" className="syn-action syn-action--outline" onClick={() => void addCp(item)}>Add CIPS record</button>{next && <button type="button" className="syn-action syn-action--ink" onClick={() => void advance(item)}>Advance<FiArrowRight /></button>}</div></td></tr>; })}{items.length === 0 && <tr><td colSpan={4}><div className="syn-empty-table"><strong>No Direct Assessment projects</strong><span>Create ECDA, ICDA, SCCDA, or Confirmatory DA work.</span></div></td></tr>}</tbody></table></div></section>
  </div></div>;
}
