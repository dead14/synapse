import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ResultsPanel from './ResultsPanel';
import {
  fetchAlignmentResult,
  fetchSharedAlignmentResult,
  type ComparisonRow,
  type ConservationAudit,
} from './utils/alignment';
import { RUN_PAIR_COLUMN, runPairLabels, withRunPairColumn } from './utils/alignmentDisplay';
import { apiFetch } from './utils/api';
import {
  applyInterventions,
  exclusionSide,
  includedInterventionRows,
  type InterventionEvent,
} from './utils/interventions';
import { createPipelineExportData } from './utils/alignmentExport';
import { resolveAlignmentSessionId } from './utils/alignmentSession';

const DefectVisualizer = lazy(() => import('./DefectVisualizer'));

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
  shareAccess?: {
    id: string;
    accessToken: string;
    sessionId: string;
  };
}

export default function IliComparisonPage({
  readOnly = false,
  shareAccess,
}: IliComparisonPageProps = {}) {
  const sharedId = shareAccess?.id;
  const sharedToken = shareAccess?.accessToken;
  const sharedSessionId = shareAccess?.sessionId;
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
  const [pipelineExportData, setPipelineExportData] = useState<Record<string, unknown>>({});
  const [pairFilter, setPairFilter] = useState<string | null>(null);
  const data = useMemo(
    () => applyInterventions(baseData, interventions),
    [baseData, interventions],
  );
  const includedData = useMemo(() => includedInterventionRows(data), [data]);
  const requestedSessionId = resolveAlignmentSessionId({
    sharedSessionId,
    search: location.search,
    storedSessionId: sharedSessionId
      ? ''
      : localStorage.getItem('synapse_last_session_id'),
  });

  // A chain result concatenates every pair's rows. Without a way to isolate one
  // transition they read as a single undifferentiated comparison.
  const pairLabels = useMemo(() => runPairLabels(includedData), [includedData]);
  // Interventions address rows by index into `data`, so a filtered view has to
  // carry the mapping back — otherwise reassigning a match while a pair is
  // selected would rewrite whichever unrelated rows sit at those offsets.
  const visibleRows = useMemo(() => {
    const indexed = data
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => includedInterventionRows([row]).length === 1);
    return pairFilter ? indexed.filter(({ row }) => row[RUN_PAIR_COLUMN] === pairFilter) : indexed;
  }, [data, pairFilter]);
  const visibleData = useMemo(() => visibleRows.map(({ row }) => row), [visibleRows]);
  const toSourceIndex = (visibleIndex: number) => visibleRows[visibleIndex]?.index ?? visibleIndex;

  useEffect(() => {
    const controller = new AbortController();

    const loadData = async () => {
      try {
        if (!requestedSessionId) throw new Error('Session ID not found. Select a pipeline first.');
        setSessionId(requestedSessionId);
        setLoading(true);
        setIsProcessing(true);
        setError(null);
        setBaseData([]);
        setInterventions([]);
        setAudit(undefined);
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
        const sessionPromise = readOnly
          ? Promise.resolve({ config: { interventions: [] as InterventionEvent[] } })
          : apiFetch<{ config?: Record<string, unknown> & { interventions?: InterventionEvent[] } }>(
            `/api/wizard/session/${encodeURIComponent(requestedSessionId)}`,
            { signal: controller.signal },
          );
        const [alignment, session] = await Promise.all([
          alignmentPromise,
          sessionPromise,
        ]);
        setAudit(alignment.audit);
        setBaseData(withRunPairColumn(alignment.comparison));
        setInterventions(session.config?.interventions || []);
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
  }, [readOnly, requestedSessionId, sharedId, sharedToken]);

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

  const handleUpdateMatch = async (visibleSourceIdx: number, visibleTargetIdx: number, evidenceScore = 0) => {
    if (readOnly) return;
    // ResultsPanel reports indexes into the rows it was given, which are the
    // filtered ones; every mutation below addresses the full `data` array.
    const sourceIdx = toSourceIndex(visibleSourceIdx);
    const targetIdx = toSourceIndex(visibleTargetIdx);
    const sourceBefore = data[sourceIdx];
    const targetBefore = data[targetIdx];
    const sourceNewKey = String(sourceBefore?.['Source Key NEW'] || '');
    const targetOldKey = String(targetBefore?.['Source Key OLD'] || '');
    const targetAlreadyHasNew = targetBefore?.['Source Key NEW'] && targetBefore['Source Key NEW'] !== '-';
    if (!sourceNewKey || sourceNewKey === '-' || !targetOldKey || targetOldKey === '-' || targetAlreadyHasNew) {
      setError('Intervention cancelled: select an unmatched NEW feature and an OLD target that has no pair yet. Existing data must not be overwritten.');
      return;
    }
    const event: InterventionEvent = {
      id: `intervention-${Date.now()}-${sourceIdx}-${targetIdx}`,
      type: 'REASSIGN_NEW', sourceNewKey, targetOldKey, evidenceScore,
    };
    try {
      await saveIntervention(event);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save the intervention event.');
      return;
    }
    setError(null);
  };

  const handleExcludeSingle = async (visibleIdx: number) => {
    if (readOnly) return;
    const sourceIdx = toSourceIndex(visibleIdx);
    const row = data[sourceIdx];
    const side = row ? exclusionSide(row) : null;
    const sourceKey = side ? String(row[`Source Key ${side}`] || '') : '';
    if (!side || !sourceKey || sourceKey === '-') {
      setError('Exclusion cancelled: select an unmatched OLD-only or NEW-only feature.');
      return;
    }
    try {
      await saveIntervention({
        id: `exclude-feature-${Date.now()}-${sourceIdx}`,
        type: 'EXCLUDE_FEATURE',
        side,
        pairIndex: Number(row.pair_index ?? 0),
        sourceKey,
      });
      setSelectedRowIdx(null);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save the exclusion.');
      throw caughtError;
    }
  };

  const handleExcludeRange = async (visibleStartIdx: number, visibleEndIdx: number) => {
    if (readOnly) return;
    const startIdx = toSourceIndex(visibleStartIdx);
    const endIdx = toSourceIndex(visibleEndIdx);
    const startRow = data[startIdx];
    const endRow = data[endIdx];
    const side = startRow ? exclusionSide(startRow) : null;
    const pairIndex = Number(startRow?.pair_index ?? 0);
    const endPairIndex = Number(endRow?.pair_index ?? 0);
    if (!side || !endRow || exclusionSide(endRow) !== side || pairIndex !== endPairIndex) {
      setError('Range exclusion cancelled: both endpoints must be unmatched features on the same OLD or NEW side and run pair.');
      return;
    }
    const startSourceKey = String(startRow[`Source Key ${side}`] || '');
    const endSourceKey = String(endRow[`Source Key ${side}`] || '');
    if (!startSourceKey || startSourceKey === '-' || !endSourceKey || endSourceKey === '-') {
      setError('Range exclusion cancelled because an endpoint has no source key.');
      return;
    }
    try {
      await saveIntervention({
        id: `exclude-range-${Date.now()}-${startIdx}-${endIdx}`,
        type: 'EXCLUDE_RANGE',
        side,
        pairIndex,
        startSourceKey,
        endSourceKey,
      });
      setSelectedRowIdx(null);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save the range exclusion.');
      throw caughtError;
    }
  };

  const handleRestoreExclusion = async (visibleIdx: number) => {
    if (readOnly) return;
    const sourceIdx = toSourceIndex(visibleIdx);
    const exclusionIds = Array.isArray(data[sourceIdx]?.__exclusionIds)
      ? data[sourceIdx].__exclusionIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (exclusionIds.length === 0) {
      setError('Restore cancelled: the selected row has no active exclusion.');
      return;
    }
    try {
      for (const [offset, exclusionId] of exclusionIds.entries()) {
        await saveIntervention({
          id: `restore-exclusion-${Date.now()}-${sourceIdx}-${offset}`,
          type: 'RESTORE_EXCLUSION',
          exclusionId,
        });
      }
      setSelectedRowIdx(null);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to restore the exclusion.');
      throw caughtError;
    }
  };

  return (
    <div className="results-workspace py-4 overflow-x-hidden w-full">
      <div className="app-page-shell flex flex-col gap-3">
        {error && (
          <div role="alert" className="syn-alert syn-alert--danger">
            <div>{error}</div>
          </div>
        )}

        {isProcessing ? (
          <div className="syn-panel mt-2">
            <JobProgressBar progress={jobProgress} message={jobMessage} />
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
                    key={`${requestedSessionId}:${pairFilter ?? 'all'}`}
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
                onExcludeRange={readOnly ? undefined : handleExcludeRange}
                onRestoreExclusion={readOnly ? undefined : handleRestoreExclusion}
                audit={audit}
                exportData={includedData}
                pipelineData={pipelineExportData}
                sessionId={sessionId}
              />
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
