import { useState, useEffect, lazy, Suspense } from 'react';
import ResultsPanel from './ResultsPanel';
import { fetchAlignmentResult, type ComparisonRow, type ConservationAudit } from './utils/alignment';
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
    <p className="text-gray-400 text-xs">Algoritma Hungarian sedang memproses data ILI di background...</p>
  </div>
);

export default function IliComparisonPage() {
  const [data, setData] = useState<ComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobMessage, setJobMessage] = useState('Mengirim data ke antrian...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAdvancedCharts, setShowAdvancedCharts] = useState(false);
  const [showVisualizer, setShowVisualizer] = useState(false);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [audit, setAudit] = useState<ConservationAudit | undefined>();

  useEffect(() => {
    const controller = new AbortController();

    const loadData = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
        if (!sessionId) throw new Error('ID sesi tidak ditemukan. Pilih pipeline terlebih dahulu.');
        setSessionId(sessionId);

        setIsProcessing(true);
        setJobProgress(10);
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
        setData(applyInterventions(alignment.comparison, session.config?.interventions || []));
      } catch (caughtError) {
        if ((caughtError as Error).name !== 'AbortError') {
          setError(caughtError instanceof Error ? caughtError.message : 'Gagal memuat hasil ILI.');
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

  const handleUpdateMatch = async (sourceIdx: number, targetIdx: number, evidenceScore = 0) => {
    const sourceBefore = data[sourceIdx];
    const targetBefore = data[targetIdx];
    const sourceNewKey = String(sourceBefore?.['Source Key NEW'] || '');
    const targetOldKey = String(targetBefore?.['Source Key OLD'] || '');
    const targetAlreadyHasNew = targetBefore?.['Source Key NEW'] && targetBefore['Source Key NEW'] !== '-';
    if (!sourceNewKey || sourceNewKey === '-' || !targetOldKey || targetOldKey === '-' || targetAlreadyHasNew) {
      setError('Intervention dibatalkan: pilih NEW unmatched dan target OLD yang belum memiliki pasangan. Data existing tidak boleh ditimpa.');
      return;
    }
    const event: InterventionEvent = {
      id: `intervention-${Date.now()}-${sourceIdx}-${targetIdx}`,
      type: 'REASSIGN_NEW', sourceNewKey, targetOldKey, evidenceScore,
    };
    if (!sessionId) {
      setError('Intervention dibatalkan karena sesi belum tersedia.');
      return;
    }
    try {
      await apiFetch('/api/wizard/save-intervention', {
        method: 'POST',
        body: JSON.stringify({ sessionId, event }),
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Gagal menyimpan intervention event.');
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
    <div className="results-workspace font-outfit py-6 text-gray-800 overflow-x-hidden w-full">
      <div className="app-page-shell flex flex-col gap-5">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isProcessing ? (
          <div className="mt-2 rounded-2xl border border-blue-100 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
            <JobProgressBar progress={jobProgress} message={jobMessage} />
          </div>
        ) : (
          <div className="mt-2 h-[calc(100vh-120px)]">
            <ResultsPanel
              data={data}
              loading={loading}
              onOpenAnalytics={() => setShowAdvancedCharts(true)}
              selectedRowIdx={selectedRowIdx}
              onSelectRowIdx={setSelectedRowIdx}
              onUpdateMatch={handleUpdateMatch}
              audit={audit}
            />
          </div>
        )}

        {data.length > 0 && !isProcessing && (
          <div>
            {!showVisualizer ? (
              <button
                onClick={() => setShowVisualizer(true)}
                className="w-full py-3 rounded-xl border-2 border-dashed border-blue-300 text-blue-500 hover:bg-blue-50 hover:border-blue-400 transition-all font-medium text-sm flex items-center justify-center gap-2"
              >
                Tampilkan Alignment Timeline Viewer (3D Chart)
              </button>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setShowVisualizer(false)}
                  className="absolute top-2 right-2 z-10 bg-white border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 shadow-sm"
                >
                  Sembunyikan Chart
                </button>
                <Suspense fallback={<LoadingSpinner label="Memuat Alignment Timeline Viewer..." />}>
                  <DefectVisualizer data={data} selectedRowIdx={selectedRowIdx} onSelectRowIdx={setSelectedRowIdx} />
                </Suspense>
              </div>
            )}
          </div>
        )}
      </div>

      {showAdvancedCharts && (
        <Suspense fallback={<LoadingSpinner label="Memuat Advanced Analytics..." />}>
          <AdvancedCharts data={data} onClose={() => setShowAdvancedCharts(false)} />
        </Suspense>
      )}
    </div>
  );
}
