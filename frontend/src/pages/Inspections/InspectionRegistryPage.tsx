import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  FiAlertTriangle,
  FiArrowDown,
  FiCheckCircle,
  FiDatabase,
  FiDownload,
  FiFileText,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiUploadCloud,
} from 'react-icons/fi';

import PageMeta from '../../components/common/PageMeta';
import SynButton from '../../components/ui/SynButton';
import {
  normalizeInspectionPage,
  normalizeInspectionProfile,
  summarizeInspectionRegistry,
  validateInspectionImport,
  type InspectionProfile,
  type InspectionRun,
} from '../../domain/inspection';
import { apiFetch, apiUrl } from '../../utils/api';
import {
  createAlignmentSessionExportPayload,
  waitForAlignmentExport,
  type AlignmentExportJob,
} from '../../utils/alignmentExport';

type RegistryResponse = { items?: unknown; nextCursor?: unknown };

function formatDate(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

function formatNumber(value: number | null) {
  return value === null ? 'Not measured' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
}

function statusClass(status: InspectionRun['evidence']['status']) {
  if (status === 'ready') return 'syn-pill syn-pill--signal';
  if (status === 'review') return 'syn-pill syn-pill--warning';
  return 'syn-pill';
}

function statusLabel(status: InspectionRun['evidence']['status']) {
  if (status === 'ready') return 'Ready';
  if (status === 'review') return 'Review evidence';
  return 'Evidence unavailable';
}

function workflowPresentation(run: InspectionRun) {
  const sessionId = run.workflow.alignmentSessionId;
  const isFfs = run.workflow.stage === 'ffs' && sessionId !== null;
  const isRuncomp = run.workflow.stage === 'runcomp' && sessionId !== null;
  const isAlignment = run.workflow.stage === 'alignment' && sessionId !== null;
  
  let label = 'Imported';
  let href = '/alignment';
  let action = 'Start alignment';

  if (isFfs) {
    label = 'FFS review ready';
    href = `/ili-comparison?sessionId=${sessionId}`;
    action = 'View Runcomp';
  } else if (isRuncomp) {
    label = 'Runcomp ready';
    href = `/ili-comparison?sessionId=${sessionId}`;
    action = 'Open Runcomp';
  } else if (isAlignment) {
    label = 'Alignment in progress';
    href = `/ili-comparison?sessionId=${sessionId}`;
    action = 'View progress';
  }

  return { label, href, action, isFfs, sessionId };
}

export default function InspectionRegistryPage() {
  const [runs, setRuns] = useState<InspectionRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pipelineName, setPipelineName] = useState('');
  const [vendor, setVendor] = useState('');
  const [surveyYear, setSurveyYear] = useState(String(new Date().getFullYear()));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState<InspectionProfile | null>(null);
  const [profileRunId, setProfileRunId] = useState<number | null>(null);
  const [downloadingSessionId, setDownloadingSessionId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadRuns({ append = false, cursor = null }: { append?: boolean; cursor?: string | null } = {}) {
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const query = cursor ? `?limit=30&cursor=${encodeURIComponent(cursor)}` : '?limit=30';
      const response = normalizeInspectionPage(await apiFetch<RegistryResponse>(`/api/inspection-runs${query}`));
      setRuns((current) => append ? [...current, ...response.items] : response.items);
      setNextCursor(response.nextCursor);
    } catch (caughtError) {
      if ((caughtError as Error).name !== 'AbortError') setError('Inspection registry could not be loaded.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { void loadRuns(); }, []);

  const summary = useMemo(() => summarizeInspectionRegistry(runs), [runs]);

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const validation = validateInspectionImport({ pipelineName, vendor, surveyYear, file });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (!file) return;

    const form = new FormData();
    form.append('file', file);
    form.append('pipelineName', pipelineName.trim());
    form.append('surveyYear', String(validation.year));
    form.append('vendor', vendor.trim());
    setUploading(true);
    setError(null);
    try {
      const response = await apiFetch<{ pipeline_run_id?: number; audit?: { accepted_rows?: number } }>('/api/upload-csv', {
        method: 'POST',
        body: form,
      });
      const accepted = Number(response.audit?.accepted_rows);
      setNotice(`Import accepted${Number.isFinite(accepted) ? `: ${accepted.toLocaleString('en-GB')} canonical rows` : ''}.`);
      setPipelineName('');
      setVendor('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadRuns();
    } catch (caughtError) {
      setError((caughtError as Error).message || 'Inspection import failed.');
    } finally {
      setUploading(false);
    }
  }

  async function showProfile(runId: number) {
    if (profileRunId === runId) {
      setProfileRunId(null);
      setProfile(null);
      return;
    }
    setProfileRunId(runId);
    setProfile(null);
    try {
      setProfile(normalizeInspectionProfile(await apiFetch<unknown>(`/api/inspection-runs/${runId}/profile`)));
    } catch {
      setError('Quality profile could not be loaded.');
    }
  }

  async function deleteRun(runId: number) {
    if (!window.confirm('Are you sure you want to delete this inspection run? This action cannot be undone.')) return;
    setError(null);
    try {
      await apiFetch(`/api/inspection-runs/${runId}`, { method: 'DELETE' });
      await loadRuns();
    } catch (caughtError) {
      setError((caughtError as Error).message || 'Failed to delete inspection run.');
    }
  }

  async function downloadRuncomp(run: InspectionRun) {
    const sessionId = run.workflow.alignmentSessionId;
    if (!run.workflow.downloadAvailable || sessionId === null) return;
    setDownloadingSessionId(sessionId);
    setError(null);
    try {
      const response = await fetch(apiUrl('/api/alignment/export-excel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(createAlignmentSessionExportPayload(sessionId, {
          pipelineName: run.pipelineName,
          inspectionRuns: [{ runId: run.id, vendor: run.vendor || '', year: run.surveyYear || '' }],
        })),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Unable to prepare Runcomp download (${response.status}).`);
      }
      if (response.status === 202) {
        const queued = await response.json() as AlignmentExportJob;
        if (!queued.exportId) throw new Error('The Runcomp export did not return an identifier.');
        await waitForAlignmentExport(
          () => apiFetch<AlignmentExportJob>(`/api/alignment/exports/${encodeURIComponent(queued.exportId)}`),
          () => new Promise((resolve) => window.setTimeout(resolve, 2_000)),
        );
        const link = document.createElement('a');
        link.href = apiUrl(`/api/alignment/exports/${encodeURIComponent(queued.exportId)}/download`);
        link.download = 'synapse_alignment_report.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'synapse_alignment_report.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Runcomp download could not be prepared.');
    } finally {
      setDownloadingSessionId(null);
    }
  }

  return (
    <div className="syn-page">
      <PageMeta title="ILI Runs · Synapse" description="Canonical vendor-agnostic inspection registry" />
      <div className="syn-shell">
        <header className="syn-registry-heading">
          <div>
            <p className="syn-kicker">Data registry · canonical evidence</p>
            <h1 className="syn-display">Inspection data<br />registry.</h1>
            <p className="syn-copy">Ingest vendor exports once. Keep the universal schema, parser evidence, checksum, and quality disposition attached to the source.</p>
          </div>
          <div className="syn-registry-heading__mark" aria-hidden="true"><FiDatabase /></div>
        </header>

        {error && <div className="syn-alert syn-alert--danger" role="alert"><FiAlertTriangle aria-hidden="true" /><span>{error}</span></div>}
        {notice && <div className="syn-alert syn-alert--success" role="status"><FiCheckCircle aria-hidden="true" /><span>{notice}</span></div>}

        <section className="syn-registry-grid syn-registry-grid--single" aria-label="Inspection data intake">
          <article className="syn-panel syn-registry-import">
            <header className="syn-section-heading">
              <div><p className="syn-kicker">Vendor-agnostic parser</p><h2 className="syn-heading">Import an ILI run</h2></div>
              <span className="syn-pill"><FiUploadCloud aria-hidden="true" /> CSV · XLSX</span>
            </header>
            <form onSubmit={(event) => void submitImport(event)} className="syn-registry-form">
              <label className="syn-field"><span>Pipeline name</span><input value={pipelineName} onChange={(event) => setPipelineName(event.target.value)} placeholder="North line / segment" maxLength={120} /></label>
              <label className="syn-field"><span>Vendor / tool</span><input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Vendor or ILI tool" maxLength={120} /></label>
              <label className="syn-field"><span>Survey year</span><input type="number" value={surveyYear} onChange={(event) => setSurveyYear(event.target.value)} min={1900} max={2100} /></label>
              <label className="syn-upload-control">
                <span><FiFileText aria-hidden="true" /> {file ? file.name : 'Choose inspection source'}</span>
                <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ready to validate` : 'The parser detects headers and field meanings automatically.'}</small>
                <input ref={fileInputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </label>
              <SynButton variant="solid" size="lg" className="syn-registry-submit" type="submit" disabled={uploading}>
                {uploading ? 'Ingesting source…' : 'Validate & import'} <FiArrowDown aria-hidden="true" />
              </SynButton>
            </form>
            <p className="syn-registry-note">A successful import persists parser version, universal schema version, row audit, uploader, and SHA-256 source fingerprint. It does not silently coerce failed rows into engineering evidence.</p>
          </article>

        </section>

        <section className="syn-panel syn-registry-table-panel" aria-labelledby="registry-title">
          <header className="syn-section-heading">
            <div><p className="syn-kicker">Persisted survey runs · {summary.pipelineCount} pipelines</p><h2 id="registry-title" className="syn-heading">Canonical inspection registry</h2></div>
            <SynButton variant="outline" size="sm" type="button" onClick={() => void loadRuns()} disabled={loading}><FiRefreshCw aria-hidden="true" /> Refresh</SynButton>
          </header>
          <div className="syn-table-wrap">
            <table className="syn-table syn-registry-table">
              <thead><tr><th scope="col">Pipeline / source</th><th scope="col">Vendor / year</th><th scope="col">Evidence</th><th scope="col">Parser provenance</th><th scope="col">Process / actions</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={5}><div className="syn-table-loading" role="status"><span className="syn-skeleton" /><span className="syn-skeleton" /><span className="syn-skeleton" /></div></td></tr>}
                {!loading && runs.length === 0 && <tr><td colSpan={5}><div className="syn-empty-table"><FiSearch aria-hidden="true" /><strong>No canonical inspection runs</strong><span>Import a vendor export above to create the first evidence-backed run.</span></div></td></tr>}
                {!loading && runs.map((run) => {
                  const workflow = workflowPresentation(run);
                  return (
                  <tr key={run.id}>
                    <td><strong>{run.pipelineName}</strong><small>{run.sourceFile || 'Source name not recorded'} · {formatDate(run.uploadedAt)}</small></td>
                    <td><strong>{run.vendor || 'Vendor not recorded'}</strong><small>{run.surveyYear ?? 'Year not recorded'} · {run.rowCount.toLocaleString('en-GB')} rows</small></td>
                    <td><span className={statusClass(run.evidence.status)}><span className="syn-dot" />{statusLabel(run.evidence.status)}</span><small>{run.evidence.acceptedRows.toLocaleString('en-GB')} accepted · {run.evidence.rejectedRows} rejected</small></td>
                    <td><strong>{run.provenance.parserVersion || 'Not recorded'}</strong><small>{run.provenance.sourceSha256 ? `${run.provenance.sourceSha256.slice(0, 12)}…` : 'Source fingerprint unavailable'}</small></td>
                    <td>
                      <div className="syn-registry-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>{workflow.label}</strong>
                        <Link to={workflow.href} className="syn-button syn-button--outline syn-button--sm">{workflow.action}</Link>
                        {workflow.isFfs && workflow.sessionId !== null && (
                          <Link to={`/ffs?sessionId=${workflow.sessionId}`} className="syn-button syn-button--solid syn-button--sm" style={{ backgroundColor: '#10b981', color: 'white' }}>Open FFS</Link>
                        )}
                        <SynButton variant="outline" size="sm" type="button" onClick={() => void showProfile(run.id)}>{profileRunId === run.id ? 'Hide profile' : 'Profile'}</SynButton>
                        {run.workflow.downloadAvailable && (
                          <SynButton variant="outline" size="sm" type="button" disabled={downloadingSessionId === run.workflow.alignmentSessionId} onClick={() => void downloadRuncomp(run)}>
                            <FiDownload aria-hidden="true" />
                            {downloadingSessionId === run.workflow.alignmentSessionId ? 'Preparing...' : 'Download'}
                          </SynButton>
                        )}
                        <SynButton variant="outline" size="sm" type="button" onClick={() => void deleteRun(run.id)} style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                          <FiTrash2 aria-hidden="true" /> Delete
                        </SynButton>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {profileRunId !== null && profile && <tr><td colSpan={5}><div className="syn-registry-profile" role="status"><strong>Run {profile.runId} quality profile</strong><span>{profile.featureCount.toLocaleString('en-GB')} features · {formatNumber(profile.distanceRangeM.minimum)}–{formatNumber(profile.distanceRangeM.maximum)} m</span><span>Depth {formatNumber(profile.coverage.depthPercent)}% · wall thickness {formatNumber(profile.coverage.wallThicknessPercent)}% · clock {formatNumber(profile.coverage.clockPositionPercent)}%</span><span>{profile.invalid.missingFeatureType} missing feature types · {profile.invalid.depthOutOfRange} depth values out of range</span></div></td></tr>}
              </tbody>
            </table>
          </div>
          {nextCursor && <div className="syn-registry-load-more"><SynButton variant="outline" type="button" disabled={loadingMore} onClick={() => void loadRuns({ append: true, cursor: nextCursor })}>{loadingMore ? 'Loading…' : 'Load more runs'}</SynButton></div>}
        </section>
      </div>
    </div>
  );
}
