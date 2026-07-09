import { useState, useEffect, lazy, Suspense } from 'react';
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

export default function IliComparisonPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdvancedCharts, setShowAdvancedCharts] = useState(false);
  const [showVisualizer, setShowVisualizer] = useState(false);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
        const token = localStorage.getItem('synapse_token') || '';
        const response = await fetch(`http://localhost:8000/api/ili-results?sessionId=${sessionId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error('Network response was not ok');
        const resData = await response.json();
        if (resData.comparison) {
          setData(resData.comparison);
        } else {
          console.error("No comparison data found in response");
        }
      } catch (error) {
        console.error("Failed to fetch ILI data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
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

        {/* Alignment Timeline Viewer - lazy loaded on demand */}
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
