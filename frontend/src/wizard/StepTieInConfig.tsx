import React, { useState, useEffect, useRef } from 'react';
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiTarget, FiActivity, FiPlus, FiTrash2 } from 'react-icons/fi';
import { apiFetch } from '../utils/api';

interface StepTieInConfigProps {
  onNext: (data: any) => void;
  onBack: () => void;
  config: any;
}

interface TieInMetrics {
  evidenceToken: string;
  methodVersion: string;
  confidence: number;
  message: string;
  candidatePairCount?: number;
  alignedPairCount?: number;
  unalignedPairCount?: number;
  matchedPairCount: number;
  inlierPairCount: number;
  residualRmseM: number;
  overlap: {
    oldStartM: number;
    oldEndM: number;
    newStartM: number;
    newEndM: number;
  };
  decision: {
    status: 'AUTO_ACCEPTED' | 'REVIEW_REQUIRED';
    reasons: string[];
    requiresHumanReview: boolean;
    evidenceScore: number;
    isProbability: false;
  };
  tieIn: {
    oldDistanceM: number;
    newDistanceM: number;
    oldId?: string | number | null;
    newId?: string | number | null;
  };
  transform: {
    direction: 'OLD_TO_NEW';
    model: 'MONOTONIC_PIECEWISE_LINEAR';
    allowExtrapolation: false;
    knots: Array<{ oldDistanceM: number; newDistanceM: number }>;
    affineFallback: { scale: number; offsetM: number; formula: string };
  };
  comparisonCoordinates?: {
    direction: 'OLD_SHIFTED_TO_NEW';
    provisionalOffsetM: number;
    isFinalTransform: false;
  };
  candidates?: Array<{
    rank: number;
    evidenceScore: number;
    pairCount: number;
    oldStartM: number;
    newStartM: number;
  }>;
}

export default function StepTieInConfig({ onNext, onBack, config }: StepTieInConfigProps) {
  const [loading, setLoading] = useState(true);
  const [autoOffset, setAutoOffset] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualOffset, setManualOffset] = useState<number | ''>('');
  const [useAuto, setUseAuto] = useState(true);
  const [excludedRanges, setExcludedRanges] = useState<Array<{ run: 'OLD' | 'NEW'; startM: number; endM: number }>>(
    Array.isArray(config?.tieInExcludedRanges) ? config.tieInExcludedRanges : [],
  );
  const [rangeDraft, setRangeDraft] = useState<{ run: 'OLD' | 'NEW'; startM: number | ''; endM: number | '' }>({ run: 'NEW', startM: '', endM: '' });

  const [tieInMetrics, setTieInMetrics] = useState<TieInMetrics | null>(null);
  const requestRevision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const currentRequest = ++requestRevision.current;

    const fetchMachineGuess = async () => {
      setLoading(true);
      setTieInMetrics(null);
      setAutoOffset(null);
      setUseAuto(false);
      try {
        const selectAnchors = (features: any[]) => features
          .filter((feature) => [
            feature.type,
            feature.feature_type,
            feature.feature_identification,
            feature.originalType,
          ].filter((value) => value !== null && value !== undefined)
            .some((value) => /weld|girth|seam|valve|tee|offtake|branch|bend|elbow|launcher|receiver/.test(String(value).toLowerCase())))
          .map((feature) => {
            const candidates = [feature.dist, feature.log_distance_m, feature.logDistance, feature.distance, feature.chainage, feature.odometer];
            const dist = candidates.map((value) => {
              const raw = String(value ?? '').trim();
              return raw ? Number(raw.replace(/,/g, '')) : Number.NaN;
            }).find(Number.isFinite);
            return { ...feature, dist };
          })
          .filter((feature) => feature.dist !== undefined);
        const oldRunReference = Number(config?.summaryData?.oldRun?.runId);
        const newRunReference = Number(config?.summaryData?.newRun?.runId);
        const hasPersistedRuns = Number.isSafeInteger(oldRunReference)
          && oldRunReference > 0
          && Number.isSafeInteger(newRunReference)
          && newRunReference > 0;
        const oldRun = selectAnchors(config?.summaryData?.oldRun?.rawFeatures || []);
        const newRun = selectAnchors(config?.summaryData?.newRun?.rawFeatures || []);
        if (!hasPersistedRuns && (oldRun.length === 0 || newRun.length === 0)) {
          if (currentRequest !== requestRevision.current) return;
          setAutoOffset(0);
          setErrorMessage('Data anchor belum tersedia pada kedua file ILI.');
          return;
        }
        const data = await apiFetch<TieInMetrics & { success: boolean; offset: number; error?: string }>('/api/estimate-tiein-offset', {
          method: 'POST',
          body: JSON.stringify({
            ...(hasPersistedRuns
              ? { oldRunId: oldRunReference, newRunId: newRunReference }
              : { oldRun, newRun }),
            excludedRanges,
          }),
          signal: controller.signal
        });
        if (currentRequest !== requestRevision.current) return;
        
        if (data.success && Number.isFinite(Number(data.offset))) {
          const roundedOffset = Math.round(data.offset * 1000) / 1000;
          setAutoOffset(roundedOffset);
          setErrorMessage(null);
          setTieInMetrics(data);
          setUseAuto(data.decision?.status === 'AUTO_ACCEPTED');
        } else {
          console.error("Tie-in estimation failed:", data.error);
          setErrorMessage(data.error || "Engine failed to return a valid offset.");
          setAutoOffset(0);
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || currentRequest !== requestRevision.current) return;
        console.error("Failed to fetch tie-in offset:", err);
        setErrorMessage(err.message || "Network error while connecting to engine.");
        setAutoOffset(0);
      } finally {
        if (currentRequest === requestRevision.current) setLoading(false);
      }
    };

    fetchMachineGuess();
    return () => {
      requestRevision.current += 1;
      controller.abort();
    };
  }, [config, excludedRanges]);

  const handleContinue = () => {
    const finalOffset = useAuto ? autoOffset : Number(manualOffset);
    onNext({
      globalOffset: finalOffset,
      tieInExcludedRanges: excludedRanges,
      tieInMetrics,
      tieInEvidenceToken: useAuto ? tieInMetrics?.evidenceToken : null,
      tieInMethodVersion: useAuto ? tieInMetrics?.methodVersion : null,
      tieInTransform: useAuto ? tieInMetrics?.transform : null,
      tieInDecision: useAuto
        ? tieInMetrics?.decision
        : { status: 'MANUAL_OVERRIDE', reasons: ['USER_SUPPLIED_LEGACY_OFFSET'] },
    });
  };

  const autoAccepted = tieInMetrics?.decision?.status === 'AUTO_ACCEPTED';

  return (
    <div className="alignment-surface bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full animate-fade-in">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FiTarget className="text-brand-500" /> Partial Run Calibration
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Temukan overlap fisik, lalu petakan run historis ke sumbu master terbaru.
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
              onClick={() => { if (autoAccepted) setUseAuto(true); }}
            >
              <div className="flex items-start gap-4">
                <div className={`mt-1 p-2 rounded-full ${useAuto ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <FiActivity size={20} />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-bold text-gray-800">Engineering Evidence Recommendation</h3>
                    {useAuto && <span className="text-xs font-bold bg-brand-500 text-white px-2 py-1 rounded-full uppercase tracking-wider">Selected</span>}
                  </div>
                  <p className="text-gray-600 mb-4">
                    Urutan GW dan landmark dicocokkan tanpa memakai absolute odometer sebagai identitas.
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
                        <p className="text-sm text-gray-500 font-medium">Titik fisik pertama yang stabil</p>
                        <p className="text-xl font-black text-gray-800 mt-1">
                          OLD {tieInMetrics?.tieIn?.oldDistanceM?.toFixed(3)} m
                          <span className="mx-2 text-brand-500">→</span>
                          NEW master {tieInMetrics?.tieIn?.newDistanceM?.toFixed(3)} m
                        </p>
                        <p className="mt-1 text-xs text-gray-500">Transform: OLD → NEW, piecewise-linear; legacy offset {autoOffset?.toLocaleString()} m</p>
                        {tieInMetrics?.comparisonCoordinates && (
                          <p className="mt-1 text-xs text-blue-700">
                            Tampilan bantu TIE IN: OLD + {tieInMetrics.comparisonCoordinates.provisionalOffsetM.toFixed(3)} m ≈ NEW. Raw odometer tidak diubah.
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold flex items-center gap-1 justify-end ${(tieInMetrics?.confidence ?? 0) >= 80 ? 'text-green-600' : 'text-amber-600'}`}>
                          <FiCheckCircle /> {tieInMetrics?.confidence ? `${tieInMetrics.confidence.toFixed(1)}/100 evidence` : 'Estimated'}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">{tieInMetrics?.message || 'Sequence Alignment (Anchors)'}</p>
                      </div>
                    </div>
                  )}
                  {tieInMetrics?.decision?.status === 'REVIEW_REQUIRED' && !errorMessage && (
                    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                      <strong>Auto-apply diblokir:</strong> {tieInMetrics.decision.reasons.join(', ')}.
                      Periksa kandidat overlap atau gunakan manual override.
                    </div>
                  )}
                  {tieInMetrics?.overlap && !errorMessage && (
                    <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 lg:grid-cols-5">
                      <span>Overlap OLD<br/><strong>{tieInMetrics.overlap.oldStartM.toFixed(2)}–{tieInMetrics.overlap.oldEndM.toFixed(2)} m</strong></span>
                      <span>Overlap NEW<br/><strong>{tieInMetrics.overlap.newStartM.toFixed(2)}–{tieInMetrics.overlap.newEndM.toFixed(2)} m</strong></span>
                      <span>GW aligned<br/><strong>{tieInMetrics.alignedPairCount ?? tieInMetrics.inlierPairCount}</strong></span>
                      <span>GW left unaligned<br/><strong>{tieInMetrics.unalignedPairCount ?? Math.max(0, tieInMetrics.matchedPairCount - tieInMetrics.inlierPairCount)}</strong></span>
                      <span>Residual RMSE<br/><strong>{tieInMetrics.residualRmseM.toFixed(3)} m</strong></span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6">
              <h3 className="font-bold text-gray-800">Exclude noisy GW area from Tie-In</h3>
              <p className="mt-1 text-sm text-gray-600">Area ini tidak dihapus dari file. Anchor di rentang tersebut hanya dikeluarkan dari estimasi Tie-In dan tetap tercatat di hasil/audit.</p>
              <div className="mt-4 grid items-end gap-3 md:grid-cols-[130px_1fr_1fr_auto]">
                <label className="text-xs font-semibold text-gray-600">Run
                  <select value={rangeDraft.run} onChange={(event) => setRangeDraft((current) => ({ ...current, run: event.target.value as 'OLD' | 'NEW' }))} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"><option value="OLD">OLD</option><option value="NEW">NEW master</option></select>
                </label>
                <label className="text-xs font-semibold text-gray-600">Start (m)
                  <input type="number" value={rangeDraft.startM} onChange={(event) => setRangeDraft((current) => ({ ...current, startM: event.target.value === '' ? '' : Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-gray-600">End (m)
                  <input type="number" value={rangeDraft.endM} onChange={(event) => setRangeDraft((current) => ({ ...current, endM: event.target.value === '' ? '' : Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" />
                </label>
                <button disabled={rangeDraft.startM === '' || rangeDraft.endM === '' || rangeDraft.startM === rangeDraft.endM} onClick={() => {
                  if (rangeDraft.startM === '' || rangeDraft.endM === '') return;
                  setExcludedRanges((current) => [...current, { run: rangeDraft.run, startM: Number(rangeDraft.startM), endM: Number(rangeDraft.endM) }]);
                  setRangeDraft((current) => ({ ...current, startM: '', endM: '' }));
                }} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><FiPlus className="mr-1 inline" />Exclude</button>
              </div>
              {excludedRanges.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{excludedRanges.map((range, index) => <span key={`${range.run}-${range.startM}-${range.endM}-${index}`} className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-800">{range.run} {Math.min(range.startM, range.endM)}–{Math.max(range.startM, range.endM)} m <button onClick={() => setExcludedRanges((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-2 text-red-600"><FiTrash2 className="inline" /></button></span>)}</div>}
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
                        Mode kompatibilitas: nilai ini ditambahkan ke odometer NEW. Untuk hasil otomatis, sistem memakai transform OLD → NEW yang lebih akurat.
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
          disabled={loading || (useAuto && !autoAccepted) || (!useAuto && manualOffset === '')}
          className="flex items-center gap-2 px-8 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm & Continue <FiArrowRight />
        </button>
      </div>
    </div>
  );
}
