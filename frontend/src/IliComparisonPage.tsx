import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import ResultsPanel from './ResultsPanel';

// Lazy load heavy components - only downloaded when needed
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
      <div
        className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
    <span className="text-blue-600 font-bold text-lg">{progress}%</span>
    <p className="text-gray-400 text-xs">Algoritma Hungarian sedang memproses data ILI di background...</p>
  </div>
);

export default function IliComparisonPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobMessage, setJobMessage] = useState('Mengirim data ke antrian...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAdvancedCharts, setShowAdvancedCharts] = useState(false);
  const [showVisualizer, setShowVisualizer] = useState(false);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollJobResult = (jobId: string, token: string) => {
    let progress = 10;
    setJobProgress(10);
    setJobMessage('Job diterima, memulai eksekusi...');

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/job/${jobId}/result`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const jobData = await res.json();

        if (jobData.state === 'completed') {
          clearInterval(pollRef.current!);
          setJobProgress(100);
          setJobMessage('Selesai! Memuat hasil...');
          setTimeout(() => {
            console.log("Job completed. Result:", jobData.result);
            if (jobData.result?.comparison) {
              console.log("Setting data length:", jobData.result.comparison.length);
              setData(jobData.result.comparison);
            } else {
              console.warn("Job completed but no comparison array found!");
            }
            setIsProcessing(false);
            setLoading(false);
          }, 800);
        } else if (jobData.state === 'failed') {
          clearInterval(pollRef.current!);
          console.error('Job failed:', jobData.failedReason);
          setJobMessage('Terjadi kesalahan saat memproses data.');
          setIsProcessing(false);
          setLoading(false);
        } else {
          // Still active/waiting — animate progress
          progress = Math.min(progress + 5, 90);
          setJobProgress(progress);
          const msgs: Record<number, string> = {
            10: 'Mengirim data ke antrian...',
            20: 'Memuat data ILI dari database...',
            35: 'Menjalankan GW Matching dengan DTW...',
            50: 'Algoritma Hungarian sedang bekerja...',
            65: 'Mencocokkan anomali OLD vs NEW...',
            80: 'Rekonsiliasi hasil & kalkulasi akurasi...',
            90: 'Hampir selesai, menyusun laporan...',
          };
          const closest = Object.keys(msgs).map(Number).reduce((a, b) => Math.abs(b - progress) < Math.abs(a - progress) ? b : a);
          setJobMessage(msgs[closest]);
        }
      } catch (e) {
        console.error('Polling error:', e);
      }
    }, 2000);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
        const token = localStorage.getItem('synapse_token') || '';
        const response = await fetch(`http://localhost:8000/api/ili-results?sessionId=${sessionId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Network response was not ok');
        const resData = await response.json();

        if (resData.jobId) {
          // New async flow — backend enqueued a job
          console.log("Enqueued job:", resData.jobId);
          setIsProcessing(true);
          pollJobResult(resData.jobId, token);
        } else if (resData.comparison) {
          // Legacy direct response
          console.log("Legacy direct response, length:", resData.comparison.length);
          setData(resData.comparison);
          setLoading(false);
        } else {
          console.error("No comparison data found in response");
          setLoading(false);
        }
      } catch (error) {
        console.error("Failed to fetch ILI data:", error);
        setLoading(false);
      }
    };
    fetchData();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleUpdateMatch = (sourceIdx: number, targetIdx: number) => {
    setData((prevData) => {
      const newData = [...prevData];
      const sourceRow = { ...newData[sourceIdx] };
      const targetRow = { ...newData[targetIdx] };
      
      // Move all NEW properties from source to target
      const newKeys = Object.keys(sourceRow).filter(k => k.includes('NEW') || k === "O'Clock NEW");
      newKeys.forEach(k => {
        targetRow[k] = sourceRow[k];
        // Clear the source new data
        if (typeof sourceRow[k] === 'number') {
           sourceRow[k] = NaN;
        } else {
           sourceRow[k] = '-';
        }
      });

      // Also ensure Identif. NEW is moved
      targetRow['Identif. NEW'] = sourceRow['Identif. NEW'];
      sourceRow['Identif. NEW'] = '-';
      targetRow['Match/Unmatch'] = 'Match';

      newData[sourceIdx] = sourceRow;
      newData[targetIdx] = targetRow;

      // Clean up empty rows if both OLD and NEW are missing
      return newData.filter(row => {
        const hasOld = row['Identif. OLD'] && row['Identif. OLD'] !== '-';
        const hasNew = row['Identif. NEW'] && row['Identif. NEW'] !== '-';
        return hasOld || hasNew;
      });
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans pt-12 pb-12 text-gray-800 overflow-x-hidden w-full">

      {/* Main Content Area */}
      <div className="max-w-[1600px] mx-auto px-8 flex flex-col gap-6">

        {/* Progress Bar while job is running */}
        {isProcessing && (
          <div className="bg-white rounded-2xl border border-blue-100 shadow-sm">
            <JobProgressBar progress={jobProgress} message={jobMessage} />
          </div>
        )}
        {data.length > 0 && (
          <div>
            {!showVisualizer ? (
              <button
                onClick={() => setShowVisualizer(true)}
                className="w-full py-3 rounded-xl border-2 border-dashed border-blue-300 text-blue-500 hover:bg-blue-50 hover:border-blue-400 transition-all font-medium text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Tampilkan Alignment Timeline Viewer (3D Chart)
              </button>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setShowVisualizer(false)}
                  className="absolute top-2 right-2 z-10 bg-white border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 shadow-sm"
                >
                  ✕ Sembunyikan Chart
                </button>
                <Suspense fallback={<LoadingSpinner label="Memuat Alignment Timeline Viewer..." />}>
                  <DefectVisualizer data={data} selectedRowIdx={selectedRowIdx} onSelectRowIdx={setSelectedRowIdx} />
                </Suspense>
              </div>
            )}
          </div>
        )}

        {/* Results Panel */}
        <div className="h-[800px] mt-4">
          <ResultsPanel 
            data={data} 
            loading={loading} 
            onOpenAnalytics={() => setShowAdvancedCharts(true)} 
            selectedRowIdx={selectedRowIdx} 
            onSelectRowIdx={setSelectedRowIdx} 
            onUpdateMatch={handleUpdateMatch}
          />
        </div>
      </div>

      {/* Advanced Analytics - lazy loaded on demand */}
      {showAdvancedCharts && (
        <Suspense fallback={<LoadingSpinner label="Memuat Advanced Analytics..." />}>
          <AdvancedCharts data={data} onClose={() => setShowAdvancedCharts(false)} />
        </Suspense>
      )}
    </div>
  );
}
