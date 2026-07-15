import React, { useState, useEffect } from 'react';
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiTarget, FiActivity } from 'react-icons/fi';
import { apiFetch } from '../utils/api';

interface StepTieInConfigProps {
  onNext: (data: any) => void;
  onBack: () => void;
  config: any;
}

export default function StepTieInConfig({ onNext, onBack, config }: StepTieInConfigProps) {
  const [loading, setLoading] = useState(true);
  const [autoOffset, setAutoOffset] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualOffset, setManualOffset] = useState<number | ''>('');
  const [useAuto, setUseAuto] = useState(true);

  const [tieInMetrics, setTieInMetrics] = useState<{ confidence: number; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchMachineGuess = async () => {
      setLoading(true);
      try {
        const selectAnchors = (features: any[]) => features
          .filter((feature) => [
            feature.type,
            feature.feature_type,
            feature.feature_identification,
            feature.originalType,
          ].filter((value) => value !== null && value !== undefined)
            .some((value) => /weld|girth|seam|valve|tee/.test(String(value).toLowerCase())))
          .map((feature) => {
            const candidates = [feature.dist, feature.log_distance_m, feature.logDistance, feature.distance, feature.chainage, feature.odometer];
            const dist = candidates.map((value) => {
              const raw = String(value ?? '').trim();
              return raw ? Number(raw.replace(/,/g, '')) : Number.NaN;
            }).find(Number.isFinite);
            return { ...feature, dist };
          })
          .filter((feature) => feature.dist !== undefined);
        const oldRun = selectAnchors(config?.summaryData?.oldRun?.rawFeatures || []);
        const newRun = selectAnchors(config?.summaryData?.newRun?.rawFeatures || []);
        if (oldRun.length === 0 || newRun.length === 0) {
          setAutoOffset(0);
          setErrorMessage('Data anchor belum tersedia pada kedua file ILI.');
          return;
        }
        const data = await apiFetch<any>('/api/estimate-tiein-offset', {
          method: 'POST',
          body: JSON.stringify({
            oldRun,
            newRun,
          }),
          signal: controller.signal
        });
        
        if (data.success && Number.isFinite(Number(data.offset))) {
          const roundedOffset = Math.round(data.offset * 1000) / 1000;
          setAutoOffset(roundedOffset);
          setErrorMessage(null);
          // Fixed: use React state instead of window global
          setTieInMetrics({ confidence: data.confidence, message: data.message });
        } else {
          console.error("Tie-in estimation failed:", data.error);
          setErrorMessage(data.error || "Engine failed to return a valid offset.");
          setAutoOffset(0);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return; // Ignore cancelled requests
        console.error("Failed to fetch tie-in offset:", err);
        setErrorMessage(err.message || "Network error while connecting to engine.");
        setAutoOffset(0);
      } finally {
        setLoading(false);
      }
    };

    fetchMachineGuess();
    return () => controller.abort(); // Cancel on unmount or config change
  }, [config]);

  const handleContinue = () => {
    const finalOffset = useAuto ? autoOffset : Number(manualOffset);
    onNext({ globalOffset: finalOffset });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full animate-fade-in">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FiTarget className="text-brand-500" /> Partial Run Calibration
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Determine the physical starting coordinate (Offset) for the partial run.
          </p>
        </div>
      </div>

      <div className="p-8 flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin mb-4"></div>
            <h3 className="text-lg font-semibold text-gray-700">Running Sliding Window Correlation...</h3>
            <p className="text-gray-500 max-w-md mt-2">
              The engine is scanning the ancestor data to find the best signal match for your partial run.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8">
            
            {/* Auto Guess Card */}
            <div 
              className={`p-6 rounded-xl border-2 transition-all cursor-pointer ${useAuto ? 'border-brand-500 bg-brand-50 shadow-md' : 'border-gray-200 hover:border-brand-300'}`}
              onClick={() => setUseAuto(true)}
            >
              <div className="flex items-start gap-4">
                <div className={`mt-1 p-2 rounded-full ${useAuto ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <FiActivity size={20} />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-bold text-gray-800">Machine Recommendation</h3>
                    {useAuto && <span className="text-xs font-bold bg-brand-500 text-white px-2 py-1 rounded-full uppercase tracking-wider">Selected</span>}
                  </div>
                  <p className="text-gray-600 mb-4">
                    Based on cross-correlation, the system detected that the New Run starts approximately at:
                  </p>
                  {errorMessage ? (
                    <div className="bg-red-50 p-4 rounded-lg border border-red-200 text-red-700 text-sm mb-4">
                      <strong>Engine Error:</strong> {errorMessage}
                      <br/>
                      <span className="text-red-500 text-xs">Please use Manual Override below.</span>
                    </div>
                  ) : (
                    <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 font-medium">Estimated Global Offset</p>
                        <p className="text-3xl font-black text-gray-800 mt-1">{autoOffset?.toLocaleString()} <span className="text-xl text-gray-500 font-medium">meters</span></p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold flex items-center gap-1 justify-end ${(tieInMetrics?.confidence ?? 0) > 80 ? 'text-green-600' : 'text-amber-600'}`}>
                          <FiCheckCircle /> {tieInMetrics?.confidence ? `${tieInMetrics.confidence.toFixed(1)}% Confidence` : 'Estimated'}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">{tieInMetrics?.message || 'Sequence Alignment (Anchors)'}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Manual Override Card */}
            <div 
              className={`p-6 rounded-xl border-2 transition-all cursor-pointer ${!useAuto ? 'border-gray-800 bg-gray-50 shadow-md' : 'border-gray-200 hover:border-gray-300'}`}
              onClick={() => setUseAuto(false)}
            >
              <div className="flex items-start gap-4">
                <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center ${!useAuto ? 'border-gray-800' : 'border-gray-300'}`}>
                  {!useAuto && <div className="w-2.5 h-2.5 bg-gray-800 rounded-full"></div>}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-bold text-gray-800">Manual Override</h3>
                    {!useAuto && <span className="text-xs font-bold bg-gray-800 text-white px-2 py-1 rounded-full uppercase tracking-wider">Selected</span>}
                  </div>
                  <p className="text-gray-600 mb-4 text-sm">
                    If the machine recommendation is incorrect, manually input the offset distance.
                  </p>
                  
                  {!useAuto && (
                    <div className="flex items-center gap-3 mt-4 animate-fade-in">
                      <div className="flex-1 max-w-xs relative">
                        <input 
                          type="number" 
                          value={manualOffset}
                          onChange={(e) => setManualOffset(Number(e.target.value))}
                          placeholder="e.g. 40000"
                          className="w-full pl-4 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-800 focus:border-gray-800 transition-all font-mono text-lg"
                        />
                        <span className="absolute right-4 top-3 text-gray-400 font-medium">m</span>
                      </div>
                      <p className="text-sm text-gray-500">
                        This value will be added to all odometers in the New Run.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 px-6 py-2.5 text-gray-600 hover:text-gray-900 font-medium transition-colors"
        >
          <FiArrowLeft /> Back
        </button>
        <button 
          onClick={handleContinue}
          disabled={loading || (!useAuto && manualOffset === '')}
          className="flex items-center gap-2 px-8 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm & Continue <FiArrowRight />
        </button>
      </div>
    </div>
  );
}
