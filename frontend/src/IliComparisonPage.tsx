import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import ResultsPanel from './ResultsPanel';
import { fetchAlignmentResult, type ComparisonRow, type ConservationAudit } from './utils/alignment';
import { RUN_PAIR_COLUMN, runPairLabels, withRunPairColumn } from './utils/alignmentDisplay';
import { apiFetch } from './utils/api';
import { applyInterventions, type InterventionEvent } from './utils/interventions';

const DefectVisualizer = lazy(() => import('./DefectVisualizer'));
const AdvancedCharts = lazy(() => import('./components/charts/AdvancedCharts'));

const LoadingSpinner = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400">
    <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    <span className="text-sm">{label}</span>
  </div>
);

const JobProgressBar = ({ progress, message }: { progress: number; message: string }) => (
  <div className="flex flex-col items-center justify-center gap-4 py-16 px-8">
    <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-2">
      <svg className="w-8 h-8 text-blue-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </div>
    <p className="text-gray-700 font-semibold text-base">{message}</p>
    <div className="w-full max-w-md bg-gray-200 rounded-full h-3 overflow-hidden">
      <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
    </div>
    <span className="text-blue-600 font-bold text-lg">{progress}%</span>
    <p className="text-gray-400 text-xs">Status updates automatically from the server. The results page opens when ready.</p>
  </div>
);

export default function IliComparisonPage() {
  const [data, setData] = useState<ComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobMessage, setJobMessage] = useState('Sending data to the queue...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAdvancedCharts, setShowAdvancedCharts] = useState(false);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [audit, setAudit] = useState<ConservationAudit | undefined>();
  const [pairFilter, setPairFilter] = useState<string | null>(null);

  // A chain result concatenates every pair's rows. Without a way to isolate one
  // transition they read as a single undifferentiated comparison.
  const pairLabels = useMemo(() => runPairLabels(data), [data]);
  // Interventions address rows by index into `data`, so a filtered view has to
  // carry the mapping back — otherwise reassigning a match while a pair is
  // selected would rewrite whichever unrelated rows sit at those offsets.
  const visibleRows = useMemo(() => {
    const indexed = data.map((row, index) => ({ row, index }));
    return pairFilter ? indexed.filter(({ row }) => row[RUN_PAIR_COLUMN] === pairFilter) : indexed;
  }, [data, pairFilter]);
  const visibleData = useMemo(() => visibleRows.map(({ row }) => row), [visibleRows]);
  const toSourceIndex = (visibleIndex: number) => visibleRows[visibleIndex]?.index ?? visibleIndex;

  useEffect(() => {
    const controller = new AbortController();

    const loadData = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
        if (!sessionId) throw new Error('Session ID not found. Select a pipeline first.');
        setSessionId(sessionId);

        setIsProcessing(true);
        setJobProgress(5);
        setJobMessage('Checking alignment status...');
        const [alignment, session] = await Promise.all([
          fetchAlignmentResult(sessionId, (progress, message) => {
            setJobProgress(progress);
            setJobMessage(message);
          }, controller.signal),
          apiFetch<{ config?: { interventions?: InterventionEvent[] } }>(
            `/api/wizard/session/${encodeURIComponent(sessionId)}`,
            { signal: controller.signal },
          ),
        ]);
        setAudit(alignment.audit);
        setData(withRunPairColumn(
          applyInterventions(alignment.comparison, session.config?.interventions || []),
        ));
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
  }, []);

  const handleUpdateMatch = async (visibleSourceIdx: number, visibleTargetIdx: number, evidenceScore = 0) => {
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
    if (!sessionId) {
      setError('Intervention cancelled because no session is available.');
      return;
    }
    try {
      await apiFetch('/api/wizard/save-intervention', {
        method: 'POST',
        body: JSON.stringify({ sessionId, event }),
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save the intervention event.');
      return;
    }

    setData((previousData) => {
      const nextData = [...previousData];
      const sourceRow = { ...nextData[sourceIdx] };
      const targetRow = { ...nextData[targetIdx] };

      // Capture the complete NEW payload before clearing the source row.  The
      // previous implementation cleared Identif. NEW and then copied it, which
      // made a successful manual intervention lose the NEW feature identity.
      const newPayload = Object.fromEntries(
        Object.keys(sourceRow)
          .filter((key) => key.includes('NEW') || key === "O'Clock NEW")
          .map((key) => [key, sourceRow[key]])
      );
      Object.entries(newPayload).forEach(([key, value]) => {
        targetRow[key] = value;
        sourceRow[key] = typeof value === 'number' ? Number.NaN : '-';
      });

      targetRow['Match/Unmatch'] = 'Match';
      nextData[sourceIdx] = sourceRow;
      nextData[targetIdx] = targetRow;

      return nextData.filter((row) => {
        const hasOld = row['Identif. OLD'] && row['Identif. OLD'] !== '-';
        const hasNew = row['Identif. NEW'] && row['Identif. NEW'] !== '-';
        return hasOld || hasNew;
      });
    });
    setError(null);
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
          <div className="mt-1 flex h-[calc(100vh-100px)] flex-col gap-2">
            {/* Handoff to the corrosion review — the only route into FFS. */}
            {sessionId && (
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
                  All ({data.length.toLocaleString()})
                </button>
                {pairLabels.map((label) => {
                  const count = data.filter((row) => row[RUN_PAIR_COLUMN] === label).length;
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
                  <DefectVisualizer data={visibleData} selectedRowIdx={selectedRowIdx} onSelectRowIdx={setSelectedRowIdx} />
                </Suspense>
              </div>
            )}

            {/* Data table. ResultsPanel asks for `h-full`, which as a direct
                flex child meant 100% of the whole workspace: it and the chart
                shrank against each other until the row area was zero pixels
                tall and the table rendered its header over nothing. Giving it
                `flex-1 min-h-0` hands it the leftover height as a definite
                size, which is what its internal scroll container needs. */}
            <div className="flex min-h-0 flex-1 flex-col" style={{ minHeight: '14rem' }}>
              <ResultsPanel
                data={visibleData}
                loading={loading}
                onOpenAnalytics={() => setShowAdvancedCharts(true)}
                selectedRowIdx={selectedRowIdx}
                onSelectRowIdx={setSelectedRowIdx}
                onUpdateMatch={handleUpdateMatch}
                audit={audit}
              />
            </div>
          </div>
        )}
      </div>

      {showAdvancedCharts && (
        <Suspense fallback={<LoadingSpinner label="Loading Advanced Analytics..." />}>
          <AdvancedCharts data={visibleData} onClose={() => setShowAdvancedCharts(false)} />
        </Suspense>
      )}
    </div>
  );
}
