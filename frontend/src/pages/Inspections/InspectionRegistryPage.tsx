import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  FiAlertTriangle,
  FiArrowDown,
  FiCheckCircle,
  FiDatabase,
  FiFileText,
  FiRefreshCw,
  FiSearch,
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
import { apiFetch } from '../../utils/api';

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

        <section className="syn-registry-grid" aria-label="Inspection data intake">
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

          <aside className="syn-panel syn-panel--ink syn-registry-readiness">
            <p className="syn-kicker">Registry snapshot</p>
            <h2 className="syn-heading">Data quality before analysis.</h2>
            <p>Alignment, FFS, risk, and repairs should consume canonical runs—not browser-only files or unnamed sessions.</p>
            <div className="syn-registry-metrics">
              <div><strong className="syn-data">{summary.runCount}</strong><span>runs in view</span></div>
              <div><strong className="syn-data">{summary.acceptedRows.toLocaleString('en-GB')}</strong><span>accepted rows</span></div>
              <div><strong className="syn-data">{summary.reviewCount}</strong><span>need review</span></div>
            </div>
          </aside>
        </section>

        <section className="syn-panel syn-registry-table-panel" aria-labelledby="registry-title">
          <header className="syn-section-heading">
            <div><p className="syn-kicker">Persisted survey runs · {summary.pipelineCount} pipelines</p><h2 id="registry-title" className="syn-heading">Canonical inspection registry</h2></div>
            <SynButton variant="outline" size="sm" type="button" onClick={() => void loadRuns()} disabled={loading}><FiRefreshCw aria-hidden="true" /> Refresh</SynButton>
          </header>
          <div className="syn-table-wrap">
            <table className="syn-table syn-registry-table">
              <thead><tr><th scope="col">Pipeline / source</th><th scope="col">Vendor / year</th><th scope="col">Evidence</th><th scope="col">Parser provenance</th><th scope="col">Quality</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={5}><div className="syn-table-loading" role="status"><span className="syn-skeleton" /><span className="syn-skeleton" /><span className="syn-skeleton" /></div></td></tr>}
                {!loading && runs.length === 0 && <tr><td colSpan={5}><div className="syn-empty-table"><FiSearch aria-hidden="true" /><strong>No canonical inspection runs</strong><span>Import a vendor export above to create the first evidence-backed run.</span></div></td></tr>}
                {!loading && runs.map((run) => (
                  <tr key={run.id}>
                    <td><strong>{run.pipelineName}</strong><small>{run.sourceFile || 'Source name not recorded'} · {formatDate(run.uploadedAt)}</small></td>
                    <td><strong>{run.vendor || 'Vendor not recorded'}</strong><small>{run.surveyYear ?? 'Year not recorded'} · {run.rowCount.toLocaleString('en-GB')} rows</small></td>
                    <td><span className={statusClass(run.evidence.status)}><span className="syn-dot" />{statusLabel(run.evidence.status)}</span><small>{run.evidence.acceptedRows.toLocaleString('en-GB')} accepted · {run.evidence.rejectedRows} rejected</small></td>
                    <td><strong>{run.provenance.parserVersion || 'Not recorded'}</strong><small>{run.provenance.sourceSha256 ? `${run.provenance.sourceSha256.slice(0, 12)}…` : 'Source fingerprint unavailable'}</small></td>
                    <td><SynButton variant="outline" size="sm" type="button" onClick={() => void showProfile(run.id)}>{profileRunId === run.id ? 'Hide profile' : 'Profile'}</SynButton></td>
                  </tr>
                ))}
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
