import { Fragment, useCallback, useEffect, useState } from 'react';
import PageMeta from '../../components/common/PageMeta';
import { apiFetch } from '../../utils/api';

type Overview = {
  organizations: string; active_organizations: string; users: string;
  active_users: string; registrations_30d: string; pending_resets: string;
};
type Member = { id: number; username: string; email: string; role: string; isActive: boolean };
type Organization = {
  id: number; name: string; slug: string; is_active: boolean; max_users: number;
  max_pipelines: number; user_count: string; pipeline_count: string; members: Member[];
};
type ResetRequest = {
  id: number; status: string; requested_at: string; username: string; email: string;
  organization_name: string;
};
type AuditEntry = {
  id: number; action: string; target?: string; created_at: string; username?: string;
  organization_name?: string; ip_address?: string;
};

export default function MasterAdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [resets, setResets] = useState<ResetRequest[]>([]);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [passwords, setPasswords] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [summary, orgs, resetQueue, audit] = await Promise.all([
        apiFetch<Overview>('/api/master-admin/overview'),
        apiFetch<Organization[]>('/api/master-admin/organizations'),
        apiFetch<ResetRequest[]>('/api/master-admin/password-resets'),
        apiFetch<{ data: AuditEntry[] }>('/api/master-admin/audit-logs?pageSize=25'),
      ]);
      setOverview(summary); setOrganizations(orgs); setResets(resetQueue); setLogs(audit.data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Master administration data could not be loaded.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveLimits = async (org: Organization) => {
    await apiFetch(`/api/master-admin/organizations/${org.id}/limits`, {
      method: 'PATCH',
      body: { maxUsers: Number(org.max_users), maxPipelines: Number(org.max_pipelines), isActive: org.is_active },
    });
    await load();
  };

  const resolveReset = async (request: ResetRequest) => {
    const newPassword = passwords[request.id] || '';
    if (newPassword.length < 8) return setError('Temporary password must contain at least 8 characters.');
    await apiFetch(`/api/master-admin/password-resets/${request.id}/resolve`, {
      method: 'POST', body: { newPassword },
    });
    setPasswords((current) => ({ ...current, [request.id]: '' }));
    await load();
  };

  const updateOrg = (id: number, patch: Partial<Organization>) =>
    setOrganizations((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));

  const metrics = overview ? [
    ['Organizations', overview.organizations, `${overview.active_organizations} active`],
    ['Registered users', overview.users, `${overview.active_users} active`],
    ['New registrations', overview.registrations_30d, 'last 30 days'],
    ['Recovery queue', overview.pending_resets, 'pending requests'],
  ] : [];

  return (
    <>
      <PageMeta title="Master administration | Synapse PIMS" description="Cross-organization governance" />
      <main className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="mx-auto max-w-[1500px] space-y-8">
          <header>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-700">System governance</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Master administration</h1>
            <p className="mt-2 text-sm text-slate-600">Tenant membership, limits, account recovery, and system audit evidence.</p>
          </header>
          {error && <div role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <section aria-label="System summary" className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map(([label, value, detail]) => (
              <article key={label} className="bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
                <strong className="mt-2 block text-3xl text-slate-950">{value}</strong>
                <span className="text-xs text-slate-500">{detail}</span>
              </article>
            ))}
          </section>

          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-5"><h2 className="text-lg font-semibold">Organizations and members</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr><th className="p-4">Organization</th><th>Usage</th><th>User limit</th><th>Pipeline limit</th><th>Status</th><th className="pr-4 text-right">Action</th></tr>
                </thead>
                <tbody>
                  {organizations.map((org) => (
                    <Fragment key={org.id}>
                      <tr className="border-t border-slate-100">
                        <td className="p-4"><button className="font-semibold text-blue-700 hover:underline" onClick={() => setExpanded(expanded === org.id ? null : org.id)}>{org.name}</button><small className="block text-slate-500">{org.slug}</small></td>
                        <td>{org.user_count} users · {org.pipeline_count} pipelines</td>
                        <td><input aria-label={`User limit for ${org.name}`} className="w-24 border p-2" type="number" min="1" value={org.max_users} onChange={(e) => updateOrg(org.id, { max_users: Number(e.target.value) })} /></td>
                        <td><input aria-label={`Pipeline limit for ${org.name}`} className="w-24 border p-2" type="number" min="1" value={org.max_pipelines} onChange={(e) => updateOrg(org.id, { max_pipelines: Number(e.target.value) })} /></td>
                        <td><label className="inline-flex items-center gap-2"><input type="checkbox" checked={org.is_active} onChange={(e) => updateOrg(org.id, { is_active: e.target.checked })} /> Active</label></td>
                        <td className="pr-4 text-right"><button className="border border-slate-300 px-3 py-2 font-semibold hover:bg-slate-50" onClick={() => void saveLimits(org)}>Save</button></td>
                      </tr>
                      {expanded === org.id && <tr className="bg-slate-50"><td colSpan={6} className="px-8 py-4">
                        <ul className="grid gap-2 md:grid-cols-2">{org.members.map((member) => <li key={member.id} className="border bg-white p-3"><strong>{member.username}</strong><span className="ml-2 text-xs uppercase text-slate-500">{member.role}</span><small className="block text-slate-500">{member.email} · {member.isActive ? 'active' : 'disabled'}</small></li>)}</ul>
                      </td></tr>}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-8 xl:grid-cols-2">
            <section className="border border-slate-200 bg-white">
              <div className="border-b p-5"><h2 className="font-semibold">Password recovery queue</h2></div>
              <div className="divide-y">
                {resets.filter((item) => item.status === 'pending').map((item) => <article key={item.id} className="p-4">
                  <strong>{item.username}</strong><span className="ml-2 text-xs text-slate-500">{item.organization_name}</span>
                  <p className="text-sm text-slate-600">{item.email}</p>
                  <div className="mt-3 flex gap-2">
                    <input aria-label={`Temporary password for ${item.username}`} className="min-w-0 flex-1 border px-3 py-2 text-sm" type="password" placeholder="Temporary password (min. 8)" value={passwords[item.id] || ''} onChange={(e) => setPasswords((p) => ({ ...p, [item.id]: e.target.value }))} />
                    <button className="bg-slate-900 px-3 py-2 text-sm font-semibold text-white" onClick={() => void resolveReset(item)}>Reset</button>
                  </div>
                </article>)}
                {!resets.some((item) => item.status === 'pending') && <p className="p-5 text-sm text-slate-500">No pending recovery requests.</p>}
              </div>
            </section>
            <section className="border border-slate-200 bg-white">
              <div className="border-b p-5"><h2 className="font-semibold">Latest audit events</h2></div>
              <ol className="divide-y">
                {logs.map((log) => <li key={log.id} className="p-4 text-sm">
                  <div className="flex justify-between gap-4"><strong>{log.action}</strong><time className="whitespace-nowrap text-xs text-slate-500">{new Date(log.created_at).toLocaleString()}</time></div>
                  <p className="mt-1 text-slate-600">{log.username || 'System'} · {log.organization_name || 'System'} · {log.target || '—'}</p>
                </li>)}
              </ol>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
