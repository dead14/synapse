import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FiFileText, FiPlus, FiShield } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { apiFetch } from '../../utils/api';

type Requirement = {
  id: number; code: string; title: string; edition: string; category: string;
  source_reference: string; accepted_links: string; applicable_links: string;
};
type Readiness = { requirements: number; accepted: number; gaps: number; ready: boolean };

export default function ComplianceRegisterPage() {
  const [items, setItems] = useState<Requirement[]>([]);
  const [readiness, setReadiness] = useState<Readiness>({ requirements: 0, accepted: 0, gaps: 0, ready: false });
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', title: '', edition: '', category: 'PLO', sourceReference: '', requirementText: '' });

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ items: Requirement[]; readiness: Readiness }>('/api/compliance/requirements');
      setItems(response.items); setReadiness(response.readiness); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Compliance register could not be loaded'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiFetch('/api/compliance/requirements', { method: 'POST', body: form });
      setForm({ code: '', title: '', edition: '', category: 'PLO', sourceReference: '', requirementText: '' });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Requirement could not be created'); }
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  return <div className="syn-page syn-ui-kit"><PageMeta title="Indonesia Compliance Pack · Synapse" description="Controlled requirement and evidence readiness" /><div className="syn-shell">
    <header className="syn-page__header"><div><p className="syn-eyebrow">Indonesia compliance pack</p><h1 className="syn-page__title">Requirement & Evidence Register</h1><p className="syn-page__subtitle">Controlled editions for PLO, RLA, reverse engineering, inspection evidence, competency, and approvals.</p></div><span className={readiness.ready ? 'syn-pill syn-pill--signal' : 'syn-pill syn-pill--warning'}><FiShield aria-hidden="true" />{readiness.ready ? 'Dossier ready' : `${readiness.gaps} gaps`}</span></header>
    {error && <div className="syn-alert syn-alert--danger" role="alert"><div>{error}</div></div>}
    <section className="mb-4 grid gap-3 md:grid-cols-3"><article className="syn-panel p-5"><p className="syn-kicker">Requirements</p><strong className="syn-data mt-2 block text-3xl">{readiness.requirements}</strong></article><article className="syn-panel p-5"><p className="syn-kicker">Accepted</p><strong className="syn-data mt-2 block text-3xl">{readiness.accepted}</strong></article><article className="syn-panel p-5"><p className="syn-kicker">Gaps</p><strong className="syn-data mt-2 block text-3xl">{readiness.gaps}</strong></article></section>
    <form className="syn-panel mb-4 grid gap-3 p-5 md:grid-cols-3" onSubmit={(event) => void submit(event)}>
      <label className="grid gap-1 text-sm">Code<input required {...field('code')} /></label><label className="grid gap-1 text-sm">Title<input required {...field('title')} /></label><label className="grid gap-1 text-sm">Edition<input required {...field('edition')} /></label>
      <label className="grid gap-1 text-sm">Category<select {...field('category')}><option>PLO</option><option>RLA</option><option>Reverse Engineering</option><option>Inspection</option><option>Approval</option></select></label>
      <label className="grid gap-1 text-sm">Controlled source<input required {...field('sourceReference')} /></label><label className="grid gap-1 text-sm">Requirement text<input required {...field('requirementText')} /></label>
      <button className="syn-action syn-action--ink md:col-span-3" type="submit"><FiPlus aria-hidden="true" />Add controlled requirement</button>
    </form>
    <section className="syn-panel overflow-hidden"><div className="syn-table-wrap"><table className="syn-table"><thead><tr><th>Requirement</th><th>Category</th><th>Edition/source</th><th>Evidence</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td><strong>{item.code} · {item.title}</strong></td><td>{item.category}</td><td><strong>{item.edition}</strong><small>{item.source_reference}</small></td><td><span className={Number(item.applicable_links) > 0 && Number(item.accepted_links) >= Number(item.applicable_links) ? 'syn-pill syn-pill--signal' : 'syn-pill syn-pill--warning'}>{item.accepted_links}/{item.applicable_links} accepted</span></td></tr>)}
      {items.length === 0 && <tr><td colSpan={4}><div className="syn-empty-table"><FiFileText aria-hidden="true" /><strong>No controlled requirements</strong><span>Add the applicable controlled edition before mapping evidence.</span></div></td></tr>}
    </tbody></table></div></section>
  </div></div>;
}
