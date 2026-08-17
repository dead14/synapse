/**
 * The ILI alignment registry.
 *
 * One table for survey data. The separate ILI-runs page showed the same runs
 * through a different query with a different set of actions on them, so a run
 * appeared twice and the two rows could disagree about what had been done to it.
 * This is what is left, and it answers both halves: which inspections were
 * compared, and what has happened to the comparison since.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  FiActivity,
  FiAlertTriangle,
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiEye,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiTrash2,
} from 'react-icons/fi';
import { Link, useNavigate } from 'react-router-dom';
import { format, isValid } from 'date-fns';

import PageMeta from './components/common/PageMeta';
import ConfirmDialog from './components/common/ConfirmDialog';
import SynButton from './components/ui/SynButton';
import { apiFetch, apiUrl } from './utils/api';
import {
  createAlignmentSessionExportPayload,
  waitForAlignmentExport,
  type AlignmentExportJob,
} from './utils/alignmentExport';
import { downloadFfsSessionReport } from './lib/ffs/sessions';
import {
  normalizeAlignmentRegistry,
  presentAlignmentRow,
  summarizeAlignmentRegistry,
  type AlignmentRegistryRow,
  type AlignmentRunSide,
} from './domain/alignmentRegistry';

/** date-fns v4 throws a RangeError on an invalid date; one malformed timestamp
 * must not take down the whole registry. */
function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return isValid(parsed) ? format(parsed, 'dd MMM yyyy') : 'Not recorded';
}

/** The API's raw status, next to pills that read "Completed" and "Failed". */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** One side of the comparison, as a single line: who flew it and when. */
function describeRun(side: AlignmentRunSide, fallback: string): string {
  const who = side.vendor || side.name || fallback;
  const when = side.surveyYear !== null
    ? String(side.surveyYear)
    : side.surveyDate
      ? side.surveyDate.slice(0, 4)
      : null;
  return when ? `${who} · ${when}` : who;
}

export default function PipelineRuns() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AlignmentRegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [downloadingAlignmentId, setDownloadingAlignmentId] = useState<string | null>(null);
  const [downloadingFfsId, setDownloadingFfsId] = useState<string | null>(null);

  async function loadRegistry() {
    setLoading(true);
    setError(null);
    try {
      setRows(normalizeAlignmentRegistry(await apiFetch<unknown>('/api/pipeline-runs')));
    } catch (caught) {
      console.error('Failed to fetch the alignment registry:', caught);
      setError('The alignment registry could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRegistry(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => (
      row.pipelineName.toLowerCase().includes(needle)
      || (row.runs.old.vendor ?? '').toLowerCase().includes(needle)
      || (row.runs.new.vendor ?? '').toLowerCase().includes(needle)
      || row.id === needle
    ));
  }, [rows, query]);

  const summary = useMemo(() => summarizeAlignmentRegistry(rows), [rows]);

  async function deleteRun(sessionId: string) {
    try {
      await apiFetch(`/api/pipeline-runs/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      setRows((previous) => previous.filter((row) => row.id !== sessionId));
    } catch (caught) {
      console.error('Failed to delete the alignment session:', caught);
      setError('The alignment session could not be deleted.');
    }
  }

  /** The alignment workbook, prepared by the API and streamed to the browser. */
  async function downloadAlignmentReport(row: AlignmentRegistryRow) {
    setDownloadingAlignmentId(row.id);
    setError(null);
    try {
      const inspectionRuns = [row.runs.old, row.runs.new]
        .filter((side) => side.runId !== null)
        .map((side) => ({
          runId: side.runId as number,
          vendor: side.vendor || '',
          year: side.surveyYear === null ? '' : String(side.surveyYear),
        }));
      const response = await fetch(apiUrl('/api/alignment/export-excel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(createAlignmentSessionExportPayload(row.id, {
          pipelineName: row.pipelineName,
          inspectionRuns,
        })),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Unable to prepare the alignment download (${response.status}).`);
      }
      if (response.status === 202) {
        const queued = await response.json() as AlignmentExportJob;
        if (!queued.exportId) throw new Error('The alignment export did not return an identifier.');
        await waitForAlignmentExport(
          () => apiFetch<AlignmentExportJob>(`/api/alignment/exports/${encodeURIComponent(queued.exportId)}`),
          () => new Promise((resolve) => window.setTimeout(resolve, 2_000)),
        );
        triggerDownload(apiUrl(`/api/alignment/exports/${encodeURIComponent(queued.exportId)}/download`));
      } else {
        const url = URL.createObjectURL(await response.blob());
        triggerDownload(url);
        URL.revokeObjectURL(url);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The alignment report could not be prepared.');
    } finally {
      setDownloadingAlignmentId(null);
    }
  }

  /**
   * The FFS workbook for the filed assessment, built in the browser from the
   * stored case by the same builder the results workspace uses — so the file
   * pulled from this table is the file the engineer would have exported.
   */
  async function downloadFfsReport(row: AlignmentRegistryRow) {
    if (row.ffs === null) return;
    setDownloadingFfsId(row.ffs.sessionId);
    setError(null);
    try {
      await downloadFfsSessionReport(row.ffs.sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The FFS report could not be prepared.');
    } finally {
      setDownloadingFfsId(null);
    }
  }

  return (
    <div className="syn-page">
      <PageMeta title="ILI alignment · Synapse" description="Inspection runs, alignment results, and FFS handoff" />
      <div className="syn-shell">
        <header className="syn-registry-heading">
          <div>
            <p className="syn-kicker">Data &amp; alignment · one registry</p>
            <h1 className="syn-display">ILI alignment<br />registry.</h1>
            <p className="syn-copy">
              Every comparison this organization has run, the inspections behind it, and what has been done with
              the result — reviewed, assessed for fitness-for-service, or still waiting.
            </p>
          </div>
          <div className="syn-registry-heading__mark" aria-hidden="true"><FiActivity /></div>
        </header>

        {error && (
          <div className="syn-alert syn-alert--danger" role="alert">
            <FiAlertTriangle aria-hidden="true" /><span>{error}</span>
          </div>
        )}

        <section className="syn-panel syn-registry-table-panel" aria-labelledby="alignment-registry-title">
          <header className="syn-section-heading">
            <div>
              <p className="syn-kicker">
                {summary.total} alignment{summary.total === 1 ? '' : 's'} ·{' '}
                {summary.assessed} assessed · {summary.awaitingAssessment} awaiting assessment
                {summary.running > 0 ? ` · ${summary.running} running` : ''}
              </p>
              <h2 id="alignment-registry-title" className="syn-heading">Alignment sessions</h2>
            </div>
            <div className="syn-registry-actions">
              <label className="syn-field syn-field--inline">
                <span className="sr-only">Search alignments</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Pipeline or vendor"
                  aria-label="Search alignments by pipeline or vendor"
                />
              </label>
              <SynButton variant="outline" size="sm" type="button" onClick={() => void loadRegistry()} disabled={loading}>
                <FiRefreshCw aria-hidden="true" /> Refresh
              </SynButton>
              <SynButton
                variant="solid"
                size="sm"
                type="button"
                onClick={() => {
                  localStorage.removeItem('synapse_alignment_wizard_progress');
                  navigate('/alignment');
                }}
              >
                New alignment
              </SynButton>
            </div>
          </header>

          <div className="syn-table-wrap">
            <table className="syn-table syn-registry-table">
              {/* Fixed proportions. Left to itself the browser gave the pipeline
                  name half the table and squeezed the actions into a four-line
                  staircase, which is what drove the row height. */}
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '40%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Pipeline / session</th>
                  <th scope="col">Inspections compared</th>
                  <th scope="col">Result</th>
                  <th scope="col">Process / actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={4}>
                      <div className="syn-table-loading" role="status">
                        <span className="syn-skeleton" /><span className="syn-skeleton" /><span className="syn-skeleton" />
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <div className="syn-empty-table">
                        <FiSearch aria-hidden="true" />
                        <strong>{rows.length === 0 ? 'No alignment sessions yet' : 'No alignment matches that search'}</strong>
                        <span>
                          {rows.length === 0
                            ? 'Start an alignment run to import inspection data and compare two surveys.'
                            : 'Clear the search to see every session.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && visible.map((row) => {
                  const view = presentAlignmentRow(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.pipelineName}</strong>
                        <small>
                          Session {row.id} · started {formatDate(row.startedAt)}
                          {row.algorithm ? ` · ${row.algorithm}` : ''}
                        </small>
                      </td>
                      <td>
                        <strong>{describeRun(row.runs.new, 'Newer run')}</strong>
                        <small>
                          vs {describeRun(row.runs.old, 'Older run')}
                          {row.runs.new.rowCount !== null
                            ? ` · ${row.runs.new.rowCount.toLocaleString('en-GB')} rows`
                            : ''}
                        </small>
                      </td>
                      <td>
                        {row.status === 'completed' ? (
                          <span className="syn-pill syn-pill--signal"><FiCheckCircle aria-hidden="true" /> Completed</span>
                        ) : row.status === 'failed' ? (
                          <span className="syn-pill syn-pill--warning"><FiAlertTriangle aria-hidden="true" /> Failed</span>
                        ) : (
                          <span className="syn-pill"><FiClock aria-hidden="true" /> {sentenceCase(row.status)}</span>
                        )}
                        <small>
                          {row.matchRate === null ? 'Match rate not measured' : `${row.matchRate.toFixed(1)}% matched`}
                          {' · '}{row.anomaliesFound.toLocaleString('en-GB')} anomalies
                        </small>
                      </td>
                      <td>
                        <div className="syn-registry-workflow">
                          <div className={`syn-registry-stage syn-registry-stage--${view.tone}`}>
                            <strong>{view.label}</strong>
                            <small>{view.note}</small>
                          </div>

                          {/* One line of actions. They used to be three stacked
                              rows, which made every row of the table four
                              buttons tall whether or not it had anything to
                              show. */}
                          <div className="syn-registry-actions">
                            {view.resultHref ? (
                              <Link to={view.resultHref} className="syn-btn syn-btn--solid syn-btn--sm">
                                <FiEye aria-hidden="true" /> Open result
                              </Link>
                            ) : (
                              <Link to="/alignment" className="syn-btn syn-btn--outline syn-btn--sm">
                                Open wizard
                              </Link>
                            )}
                            {/* Exactly one FFS action per row, and only the one
                                this session actually has: re-opening a filed
                                assessment, or running the first one. */}
                            {view.openFfsHref && (
                              <Link to={view.openFfsHref} className="syn-btn syn-btn--outline syn-btn--sm">
                                <FiShield aria-hidden="true" /> Open FFS
                              </Link>
                            )}
                            {view.runFfsHref && (
                              <Link to={view.runFfsHref} className="syn-btn syn-btn--outline syn-btn--sm">
                                <FiShield aria-hidden="true" /> Run FFS
                              </Link>
                            )}
                            {row.result.available && (
                              <SynButton
                                variant="outline"
                                size="sm"
                                type="button"
                                disabled={downloadingAlignmentId === row.id}
                                onClick={() => void downloadAlignmentReport(row)}
                              >
                                <FiDownload aria-hidden="true" />
                                {downloadingAlignmentId === row.id ? 'Preparing…' : 'Alignment report'}
                              </SynButton>
                            )}
                            {row.ffs !== null && (
                              <SynButton
                                variant="outline"
                                size="sm"
                                type="button"
                                disabled={downloadingFfsId === row.ffs.sessionId}
                                onClick={() => void downloadFfsReport(row)}
                              >
                                <FiDownload aria-hidden="true" />
                                {downloadingFfsId === row.ffs.sessionId ? 'Preparing…' : 'FFS report'}
                              </SynButton>
                            )}
                            {/* Destructive, so it sits apart from the rest of
                                the row rather than next to "Open result". */}
                            <SynButton
                              variant="ghost"
                              size="sm"
                              type="button"
                              className="syn-registry-delete"
                              title="Delete this alignment session"
                              aria-label={`Delete alignment session ${row.id}`}
                              onClick={() => setPendingDeleteId(row.id)}
                            >
                              <FiTrash2 aria-hidden="true" />
                            </SynButton>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {pendingDeleteId !== null && (
        <ConfirmDialog
          title="Delete this alignment session?"
          message="This permanently removes the session and its alignment result. Filed FFS assessments are kept, but lose the session they came from. This action cannot be undone."
          confirmLabel="Delete session"
          danger
          onConfirm={() => {
            const sessionId = pendingDeleteId;
            setPendingDeleteId(null);
            void deleteRun(sessionId);
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
}

/** Clicks a temporary link, which is the only way to name a downloaded file. */
function triggerDownload(href: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = 'synapse_alignment_report.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
