import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ResultsPanel from './ResultsPanel';
import {
  fetchAlignmentResult,
  fetchSharedAlignmentResult,
  type ComparisonRow,
  type ConservationAudit,
} from './utils/alignment';
import {
  RUN_PAIR_COLUMN,
  isHiddenAlignmentRow,
  normalizeHiddenFeatures,
  runPairLabels,
  withRunPairColumn,
} from './utils/alignmentDisplay';
import { apiFetch } from './utils/api';
import {
  applyInterventions,
  exclusionIdsOf,
  exclusionTarget,
  includedInterventionRows,
  isExcludedRow,
  isMatchedRow,
  type InterventionEvent,
} from './utils/interventions';
import { createPipelineExportData } from './utils/alignmentExport';
import { collectAuroraArtifacts } from './domain/auroraEvidence';
import {
  LAST_SESSION_STORAGE_KEY,
  forgetUnusableStoredSession,
  isAlignmentSessionId,
  parseAlignmentShareReference,
  resolveAlignmentSessionId,
} from './utils/alignmentSession';

const DefectVisualizer = lazy(() => import('./DefectVisualizer'));
// Only AURORA runs carry these artifacts, so the panel is loaded on demand
// rather than shipped to every session that opens a comparison.
const AuroraEvidencePanel = lazy(() => import('./components/comparison/AuroraEvidencePanel'));

const LoadingSpinner = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400">
    <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    <span className="text-sm">{label}</span>
  </div>
);

const RESULT_STAGES = [
  { threshold: 5, label: 'Verify session' },
  { threshold: 25, label: 'Read source rows' },
  { threshold: 80, label: 'Match & validate' },
  { threshold: 100, label: 'Assemble report' },
];

const JobProgressBar = ({ progress, message }: { progress: number; message: string }) => {
  const safeProgress = Math.max(0, Math.min(100, progress));
  return (
    <div className="result-processing" aria-live="polite">
      <div className="result-processing__signal" aria-hidden="true">
        <i /><i /><i />
        <span>{safeProgress}%</span>
      </div>
      <div className="result-processing__copy">
        <p className="syn-kicker">Alignment evidence pipeline</p>
        <h2>{message}</h2>
        <p>Rows are loaded in bounded pages and source-key conservation is checked before release.</p>
      </div>
      <div
        className="result-processing__track"
        role="progressbar"
        aria-valuenow={safeProgress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Alignment result loading progress"
      >
        <i style={{ width: `${safeProgress}%` }} />
      </div>
      <ol className="result-processing__stages">
        {RESULT_STAGES.map((stage, index) => {
          const previous = RESULT_STAGES[index - 1]?.threshold ?? 0;
          const isDone = safeProgress >= stage.threshold;
          const isActive = !isDone && safeProgress >= previous;
          return (
            <li key={stage.label} className={isDone ? 'is-done' : isActive ? 'is-active' : ''}>
              <span>{isDone ? '✓' : index + 1}</span>
              {stage.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

interface IliComparisonPageProps {
  readOnly?: boolean;
  sharedInterventions?: unknown[];
  sharedSections?: unknown[];
  /**
   * Feature classes the author had switched off. Carried on the share so the
   * recipient opens the report the author was reading, not a wider one.
   */
  sharedHiddenFeatures?: unknown[];
  shareAccess?: {
    id: string;
    accessToken: string;
    /** Session or run the shared rows are read from, as published. */
    sourceRef: string;
  };
}

export default function IliComparisonPage({
  readOnly = false,
  sharedInterventions,
  sharedSections,
  sharedHiddenFeatures,
  shareAccess,
}: IliComparisonPageProps = {}) {
  const sharedId = shareAccess?.id;
  const sharedToken = shareAccess?.accessToken;
  // A shared link is opened by its own reference, so the viewer never falls back
  // to a session ID left in their browser from an unrelated pipeline. The
  // reference names either the released run or its session; only the latter can
  // address a session, and neither is needed to read the rows.
  const shareReference = parseAlignmentShareReference(shareAccess?.sourceRef);
  const sharedSessionId = shareReference?.kind === 'session' ? shareReference.id : '';
  const [baseData, setBaseData] = useState<ComparisonRow[]>([]);
  const [interventions, setInterventions] = useState<InterventionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobMessage, setJobMessage] = useState('Sending data to the queue...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [audit, setAudit] = useState<ConservationAudit | undefined>();
  // The completed run behind these rows. A published link names it, so the
  // recipient always reads the run that was released rather than the newest one.
  const [alignmentJobId, setAlignmentJobId] = useState('');
  // Section names, as saved on the session. The read-only page cannot call the
  // authenticated session endpoint, so a shared link carries them instead.
  const [sections, setSections] = useState<unknown[]>([]);
  const [pipelineExportData, setPipelineExportData] = useState<Record<string, unknown>>({});
  const [pairFilter, setPairFilter] = useState<string | null>(null);
  // The Feature rules step's saved decision. It is applied here rather than in
  // the engine because it is a report-visibility choice: the run still matched
  // and conserved every row, and turning a class back on must not require a
  // re-run.
  const [hiddenFeatures, setHiddenFeatures] = useState<string[]>([]);
  // The Tolerances step's clustered-metal-loss decision. Unlike the visibility
  // rules above this one was applied by the engine, so it is read back only to
  // keep the manual reassignment path agreeing with the run that produced these
  // rows — changing it means re-running the alignment.
  const [clusterAlignment, setClusterAlignment] = useState<'bypass' | 'align'>('bypass');
  const data = useMemo(
    () => applyInterventions(baseData, interventions),
    [baseData, interventions],
  );
  // `data` stays complete: interventions address rows by index into it, and a
  // hidden row is still a row the reviewer may have excluded or reassigned.
  const reportData = useMemo(
    () => (hiddenFeatures.length === 0
      ? data
      : data.filter((row) => !isHiddenAlignmentRow(row, hiddenFeatures))),
    [data, hiddenFeatures],
  );
  const includedData = useMemo(() => includedInterventionRows(reportData), [reportData]);
  const requestedSessionId = resolveAlignmentSessionId({
    sharedSessionId,
    search: location.search,
    storedSessionId: shareAccess
      ? ''
      : localStorage.getItem(LAST_SESSION_STORAGE_KEY),
  });
  // What this render of the page is looking at. A share is identified by the
  // link itself, so the read-only view stays keyed to the published result even
  // when the link names a run rather than a session.
  const resultIdentity = shareAccess ? `${shareAccess.id}:${shareAccess.sourceRef}` : requestedSessionId;

  // A chain result concatenates every pair's rows. Without a way to isolate one
  // transition they read as a single undifferentiated comparison.
  const pairLabels = useMemo(() => runPairLabels(includedData), [includedData]);
  // Present only for AURORA runs; every other strategy leaves this empty and
  // the page renders exactly as it always has.
  const auroraArtifacts = useMemo(() => collectAuroraArtifacts(audit), [audit]);
  // Interventions address rows by index into `data`, so a filtered view has to
  // carry the mapping back — otherwise reassigning a match while a pair is
  // selected would rewrite whichever unrelated rows sit at those offsets.
  //
  // Excluded rows stay in this list. They are what the Excluded tab is for, and
  // filtering them out here is what used to leave that tab permanently empty;
  // every consumer that must not see them (charts, exports) filters for itself.
  const visibleRows = useMemo(() => {
    const indexed = data
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !isHiddenAlignmentRow(row, hiddenFeatures));
    return pairFilter ? indexed.filter(({ row }) => row[RUN_PAIR_COLUMN] === pairFilter) : indexed;
  }, [data, hiddenFeatures, pairFilter]);
  const visibleData = useMemo(() => visibleRows.map(({ row }) => row), [visibleRows]);
  const toSourceIndex = (visibleIndex: number) => visibleRows[visibleIndex]?.index ?? visibleIndex;

  useEffect(() => {
    const controller = new AbortController();

    const loadData = async () => {
      try {
        // A published link is read through its own endpoint, against the run it
        // was created from. It carries no session the recipient could open, and
        // it must never fall through to the session checks below — the id there
        // belongs to the author, not to the link.
        if (shareAccess) {
          if (!shareReference) {
            throw new Error('This shared link does not name an alignment result to open.');
          }
        } else {
          if (!requestedSessionId) {
            throw new Error('No alignment session selected. Open one from ILI runs, or start an alignment.');
          }
          // An id that cannot address a session is caught here rather than sent to
          // the API, which would answer with a bare "Invalid session ID" that says
          // nothing about which session or what to do about it.
          if (!isAlignmentSessionId(requestedSessionId)) {
            forgetUnusableStoredSession();
            throw new Error(
              `"${requestedSessionId}" is not an alignment session reference. `
              + 'Open a session from ILI runs, or start an alignment.',
            );
          }
        }
        setSessionId(shareAccess ? '' : requestedSessionId);
        setLoading(true);
        setIsProcessing(true);
        setError(null);
        setBaseData([]);
        setInterventions([]);
        setAudit(undefined);
        setAlignmentJobId('');
        setSections([]);
        setHiddenFeatures([]);
        setPipelineExportData({});
        setPairFilter(null);
        setSelectedRowIdx(null);
        setJobProgress(5);
        setJobMessage('Checking alignment status...');
        const progress = (value: number, message: string) => {
          setJobProgress(value);
          setJobMessage(message);
        };
        const alignmentPromise = sharedId && sharedToken
          ? fetchSharedAlignmentResult(
            sharedId,
            sharedToken,
            progress,
            controller.signal,
          )
          : fetchAlignmentResult(requestedSessionId, progress, controller.signal);
        type SessionResponse = {
          config?: Record<string, unknown> & { interventions?: InterventionEvent[] };
        };
        const sessionPromise: Promise<SessionResponse> = readOnly
          ? Promise.resolve({
            config: {
              interventions: (sharedInterventions ?? []) as InterventionEvent[],
              matchingSections: sharedSections ?? [],
              hiddenFeatures: sharedHiddenFeatures ?? [],
            },
          })
          : apiFetch<SessionResponse>(
            `/api/wizard/session/${encodeURIComponent(requestedSessionId)}`,
            { signal: controller.signal },
          );
        const [alignment, session] = await Promise.all([
          alignmentPromise,
          sessionPromise,
        ]);
        setAudit(alignment.audit);
        setAlignmentJobId(alignment.jobId ?? '');
        setBaseData(withRunPairColumn(alignment.comparison));
        setInterventions(session.config?.interventions || []);
        const configuredSections = Array.isArray(session.config?.matchingSections)
          && session.config.matchingSections.length > 0
          ? session.config.matchingSections
          : session.config?.sections;
        setSections(Array.isArray(configuredSections) ? configuredSections : []);
        setHiddenFeatures(normalizeHiddenFeatures(session.config?.hiddenFeatures));
        setClusterAlignment(
          (session.config?.ToleranceConfig as { cluster_alignment?: unknown } | undefined)
            ?.cluster_alignment === 'align'
            ? 'align'
            : 'bypass',
        );
        setPipelineExportData(createPipelineExportData(session.config || {}));
      } catch (caughtError) {
        if ((caughtError as Error).name !== 'AbortError') {
          setError(caughtError instanceof Error ? caughtError.message : 'Failed to load ILI results.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsProcessing(false);
          setLoading(false);
        }
      }
    };

    void loadData();
    return () => controller.abort();
    // The shared state arrives once, with the share, and is read inside the
    // load; re-running on its array identity would reload the whole result for
    // nothing.
  }, [readOnly, requestedSessionId, sharedId, sharedToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveIntervention = async (event: InterventionEvent): Promise<InterventionEvent> => {
    if (!sessionId) throw new Error('Intervention cancelled because no session is available.');
    const response = await apiFetch<{ event: InterventionEvent }>('/api/wizard/save-intervention', {
      method: 'POST',
      body: JSON.stringify({ sessionId, event }),
    });
    setInterventions((current) => (
      current.some((item) => item.id === response.event.id)
        ? current
        : [...current, response.event]
    ));
    return response.event;
  };

  /**
   * Persist several events as one reviewer action. They are saved in order and
   * the first failure stops the batch, so a partial result is always a prefix
   * of what was asked for rather than an arbitrary subset.
   */
  const saveInterventions = async (
    events: InterventionEvent[],
    failureMessage: string,
  ): Promise<number> => {
    let saved = 0;
    try {
      for (const event of events) {
        await saveIntervention(event);
        saved += 1;
      }
      setError(null);
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : failureMessage;
      setError(saved === 0
        ? reason
        : `${reason} — ${saved} of ${events.length} changes were saved.`);
      throw caughtError;
    }
    return saved;
  };

  const handleUpdateMatch = async (visibleSourceIdx: number, visibleTargetIdx: number, evidenceScore = 0) => {
    if (readOnly) return;
    // ResultsPanel reports indexes into the rows it was given, which are the
    // filtered ones; every mutation below addresses the full `data` array.
    const sourceIdx = toSourceIndex(visibleSourceIdx);
    const targetIdx = toSourceIndex(visibleTargetIdx);
    const sourceBefore = data[sourceIdx];
    const targetBefore = data[targetIdx];
    if (!sourceBefore || !targetBefore) return;
    // Either half can be the one that moves: an orphan NEW feature onto an OLD
    // row, or an orphan OLD feature onto a NEW row. Which one it is follows
    // from the side the source row actually carries.
    const sourceSide = exclusionTarget(sourceBefore)?.side;
    const moving = sourceSide === 'OLD' || sourceSide === 'NEW' ? sourceSide : null;
    const anchor = moving === 'NEW' ? 'OLD' : 'NEW';
    const sourceKey = moving ? String(sourceBefore[`Source Key ${moving}`] || '') : '';
    const targetKey = String(targetBefore[`Source Key ${anchor}`] || '');
    const targetSide = exclusionTarget(targetBefore)?.side;
    if (!moving || !sourceKey || sourceKey === '-' || !targetKey || targetKey === '-'
      || targetSide !== anchor) {
      setError(`Intervention cancelled: pair an unmatched ${moving ?? 'OLD or NEW'} feature with a ${anchor} row that has no partner yet. Existing data must not be overwritten.`);
      return;
    }
    const event: InterventionEvent = moving === 'NEW'
      ? {
        id: `intervention-${Date.now()}-${sourceIdx}-${targetIdx}`,
        type: 'REASSIGN_NEW',
        sourceNewKey: sourceKey,
        targetOldKey: targetKey,
        evidenceScore,
      }
      : {
        id: `intervention-${Date.now()}-${sourceIdx}-${targetIdx}`,
        type: 'REASSIGN_OLD',
        sourceOldKey: sourceKey,
        targetNewKey: targetKey,
        evidenceScore,
      };
    try {
      await saveIntervention(event);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save the intervention event.');
      return;
    }
    setError(null);
  };

  /** Break a match apart so both halves can be paired with something else. */
  const handleUnassign = async (visibleIdxs: number[]) => {
    if (readOnly) return;
    const events: InterventionEvent[] = [];
    for (const visibleIdx of visibleIdxs) {
      const sourceIdx = toSourceIndex(visibleIdx);
      const row = data[sourceIdx];
      if (!row || !isMatchedRow(row)) continue;
      const sourceOldKey = String(row['Source Key OLD'] || '');
      const sourceNewKey = String(row['Source Key NEW'] || '');
      if (!sourceOldKey || sourceOldKey === '-' || !sourceNewKey || sourceNewKey === '-') continue;
      events.push({
        id: `unassign-${Date.now()}-${sourceIdx}`,
        type: 'UNASSIGN_PAIR',
        sourceOldKey,
        sourceNewKey,
      });
    }
    if (events.length === 0) {
      setError('Unassign cancelled: select at least one matched row that carries both source keys.');
      return;
    }
    await saveInterventions(events, 'Failed to unassign the selected matches.');
    setSelectedRowIdx(null);
  };

  /**
   * Exclude every selected row. Any row qualifies — an unmatched anomaly, a
   * valve or tee, or a matched pair — because the decision being recorded is
   * "keep this out of the released outputs".
   */
  const handleExcludeMany = async (visibleIdxs: number[]) => {
    if (readOnly) return;
    const events: InterventionEvent[] = [];
    for (const visibleIdx of visibleIdxs) {
      const sourceIdx = toSourceIndex(visibleIdx);
      const row = data[sourceIdx];
      if (!row || isExcludedRow(row)) continue;
      const target = exclusionTarget(row);
      if (!target) continue;
      events.push({
        id: `exclude-feature-${Date.now()}-${sourceIdx}`,
        type: 'EXCLUDE_FEATURE',
        side: target.side,
        pairIndex: Number(row.pair_index ?? 0),
        sourceKey: target.sourceKey,
      });
    }
    if (events.length === 0) {
      setError('Exclusion cancelled: the selected rows carry no source key to record the decision against.');
      return;
    }
    await saveInterventions(events, 'Failed to save the exclusion.');
    setSelectedRowIdx(null);
  };

  const handleExcludeSingle = (visibleIdx: number) => handleExcludeMany([visibleIdx]);

  const handleExcludeRange = async (visibleStartIdx: number, visibleEndIdx: number) => {
    if (readOnly) return;
    const startIdx = toSourceIndex(visibleStartIdx);
    const endIdx = toSourceIndex(visibleEndIdx);
    const startRow = data[startIdx];
    const endRow = data[endIdx];
    const start = startRow ? exclusionTarget(startRow) : null;
    const end = endRow ? exclusionTarget(endRow) : null;
    const pairIndex = Number(startRow?.pair_index ?? 0);
    const endPairIndex = Number(endRow?.pair_index ?? 0);
    if (!start || !end || start.side !== end.side || pairIndex !== endPairIndex) {
      setError('Range exclusion cancelled: both endpoints must sit on the same side — OLD only, NEW only, or matched — and the same run pair.');
      return;
    }
    try {
      await saveIntervention({
        id: `exclude-range-${Date.now()}-${startIdx}-${endIdx}`,
        type: 'EXCLUDE_RANGE',
        side: start.side,
        pairIndex,
        startSourceKey: start.sourceKey,
        endSourceKey: end.sourceKey,
      });
      setSelectedRowIdx(null);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save the range exclusion.');
      throw caughtError;
    }
  };

  const handleRestoreExclusion = async (visibleIdxs: number | number[]) => {
    if (readOnly) return;
    const indexes = Array.isArray(visibleIdxs) ? visibleIdxs : [visibleIdxs];
    // A range exclusion covers many rows under one ID; restoring it once puts
    // all of them back, so the same ID must not be sent per selected row.
    const exclusionIds = new Set<string>();
    for (const visibleIdx of indexes) {
      const row = data[toSourceIndex(visibleIdx)];
      if (row) exclusionIdsOf(row).forEach((id) => exclusionIds.add(id));
    }
    const events: InterventionEvent[] = [...exclusionIds].map((exclusionId, offset) => ({
      id: `restore-exclusion-${Date.now()}-${offset}`,
      type: 'RESTORE_EXCLUSION',
      exclusionId,
    }));
    if (events.length === 0) {
      setError('Restore cancelled: the selected rows have no active exclusion.');
      return;
    }
    await saveInterventions(events, 'Failed to restore the exclusion.');
    setSelectedRowIdx(null);
  };

  return (
    <div className="results-workspace py-4 overflow-x-hidden w-full">
      <div className="app-page-shell flex flex-col gap-3">
        {error && (
          <div role="alert" className="syn-alert syn-alert--danger">
            <div>{error}</div>
            {/* Without a session there is nothing on this page to act on, so the
                alert carries the way out rather than leaving a dead screen. */}
            {!readOnly && !sessionId && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Link to="/alignment-history" className="syn-btn syn-btn--solid syn-btn--sm">Go to ILI alignment</Link>
                <Link to="/alignment" className="syn-btn syn-btn--outline syn-btn--sm">Start an alignment</Link>
              </div>
            )}
          </div>
        )}

        {isProcessing ? (
          <div className="result-processing-shell">
            <div className="syn-panel result-processing-card">
              <JobProgressBar progress={jobProgress} message={jobMessage} />
            </div>
          </div>
        ) : (
          <div className="mt-1 flex flex-col gap-2">
            {/* Handoff to the corrosion review — the only route into FFS. */}
            {!readOnly && sessionId && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                style={{ borderRadius: 'var(--syn-radius-control)', border: '1px solid var(--syn-line)', background: 'var(--syn-surface)' }}
              >
                <span className="text-xs" style={{ color: 'var(--syn-text-muted, #64748b)' }}>
                  Alignment complete. Review the corrosion condition to release features for fitness-for-service.
                </span>
                <Link
                  to={`/alignment/${encodeURIComponent(sessionId)}/corrosion`}
                  className="syn-btn syn-btn--sm syn-btn--lime"
                  style={{ minHeight: '1.75rem', fontSize: '0.68rem' }}
                >
                  Corrosion Analysis →
                </Link>
              </div>
            )}

            {/* AURORA registration evidence. Every other strategy renders the
                page exactly as before — the panel appears only when the run
                that produced these rows was an AURORA run. */}
            {auroraArtifacts.length > 0 && (
              <Suspense fallback={<LoadingSpinner label="Loading registration evidence..." />}>
                {auroraArtifacts.map((artifacts, index) => (
                  <AuroraEvidencePanel
                    key={artifacts.summary.pairLabel || index}
                    artifacts={artifacts}
                  />
                ))}
              </Suspense>
            )}

            {/* Said out loud. Without it the row counts simply read low, and a
                reviewer looking for a valve has no way to tell that the Feature
                rules step is why it is not there. */}
            {hiddenFeatures.length > 0 && data.length > reportData.length && (
              <div
                className="flex flex-wrap items-center gap-2 px-3 py-2"
                style={{ borderRadius: 'var(--syn-radius-control)', border: '1px solid var(--syn-line)', background: 'var(--syn-surface)' }}
              >
                <span className="syn-kicker" style={{ fontSize: '0.6rem' }}>Feature rules</span>
                <span className="text-xs" style={{ color: 'var(--syn-text-muted, #64748b)' }}>
                  {(data.length - reportData.length).toLocaleString()} row(s) hidden by the saved
                  visibility rules: {hiddenFeatures.join(', ')}. They were matched and conserved by
                  the run — change the rules in the alignment wizard to bring them back.
                </span>
              </div>
            )}

            {/* Run pair filter */}
            {pairLabels.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderRadius: 'var(--syn-radius-control)', border: '1px solid var(--syn-line)', background: 'var(--syn-surface)' }}>
                <span className="syn-kicker" style={{ fontSize: '0.6rem' }}>Run pair</span>
                <button
                  type="button"
                  aria-pressed={pairFilter === null}
                  onClick={() => setPairFilter(null)}
                  className={`syn-btn syn-btn--sm ${pairFilter === null ? 'syn-btn--ink' : 'syn-btn--outline'}`}
                  style={{ minHeight: '1.75rem', fontSize: '0.68rem' }}
                >
                  All ({includedData.length.toLocaleString()})
                </button>
                {pairLabels.map((label) => {
                  const count = includedData.filter((row) => row[RUN_PAIR_COLUMN] === label).length;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={pairFilter === label}
                      onClick={() => { setPairFilter(label); setSelectedRowIdx(null); }}
                      className={`syn-btn syn-btn--sm ${pairFilter === label ? 'syn-btn--ink' : 'syn-btn--outline'}`}
                      style={{ minHeight: '1.75rem', fontSize: '0.68rem' }}
                    >
                      {label} ({count.toLocaleString()})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Alignment comparison chart (always visible when data available).
                It keeps its natural height — the lanes carry a run each and
                must not be sliced in half to make room for the table. */}
            {visibleData.length > 0 && (
              <div className="shrink-0">
                <Suspense fallback={<LoadingSpinner label="Loading comparison chart..." />}>
                  <DefectVisualizer
                    key={`${resultIdentity}:${pairFilter ?? 'all'}`}
                    data={visibleData}
                    selectedRowIdx={selectedRowIdx}
                    onSelectRowIdx={setSelectedRowIdx}
                  />
                </Suspense>
              </div>
            )}

            {/* Data table. ResultsPanel asks for `h-full`, which as a direct
                flex child meant 100% of the whole workspace: it and the chart
                shrank against each other until the row area was zero pixels
                tall and the table rendered its header over nothing. Giving it
                `flex-1 min-h-0` hands it the leftover height as a definite
                size, which is what its internal scroll container needs. */}
            <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
              <ResultsPanel
                data={visibleData}
                loading={loading}
                readOnly={readOnly}
                onOpenAnalytics={readOnly || !sessionId ? undefined : () => navigate(`/alignment/${encodeURIComponent(sessionId)}/corrosion`)}
                selectedRowIdx={selectedRowIdx}
                onSelectRowIdx={setSelectedRowIdx}
                onUpdateMatch={readOnly ? undefined : handleUpdateMatch}
                onExcludeSingle={readOnly ? undefined : handleExcludeSingle}
                onExcludeMany={readOnly ? undefined : handleExcludeMany}
                onExcludeRange={readOnly ? undefined : handleExcludeRange}
                onRestoreExclusion={readOnly ? undefined : handleRestoreExclusion}
                onUnassign={readOnly ? undefined : handleUnassign}
                audit={audit}
                exportData={includedData}
                pipelineData={pipelineExportData}
                sessionId={sessionId}
                jobId={alignmentJobId}
                interventions={interventions}
                sections={sections}
                hiddenFeatures={hiddenFeatures}
                clusterAlignment={clusterAlignment}
              />
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
