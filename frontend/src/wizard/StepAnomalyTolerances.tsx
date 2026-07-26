import { useMemo, useState } from 'react';
import { FiSliders, FiChevronRight, FiChevronLeft, FiAward } from 'react-icons/fi';
import { primaryWizardRunPair, resolveWizardRunPairs } from '../domain/multiRun';

interface StepAnomalyTolerancesProps {
  onNext: (config: any) => void;
  onBack: () => void;
  config?: any;
}

type ToleranceValues = {
  clock_tolerance: number;
  us_gw_distance_tolerance: number;
  ds_gw_distance_tolerance: number;
  use_us_gw_distance: boolean;
  length_tolerance: number;
};

const RECOMMENDED: ToleranceValues = {
  clock_tolerance: 15,
  us_gw_distance_tolerance: 0.2,
  ds_gw_distance_tolerance: 0.2,
  use_us_gw_distance: true,
  length_tolerance: 50,
};

function toleranceValues(source: any, fallbackDistThresh: unknown): ToleranceValues {
  return {
    clock_tolerance: source?.clock_tolerance ?? RECOMMENDED.clock_tolerance,
    us_gw_distance_tolerance: source?.us_gw_distance_tolerance ?? fallbackDistThresh ?? RECOMMENDED.us_gw_distance_tolerance,
    ds_gw_distance_tolerance: source?.ds_gw_distance_tolerance ?? fallbackDistThresh ?? RECOMMENDED.ds_gw_distance_tolerance,
    use_us_gw_distance: source?.use_us_gw_distance !== false,
    length_tolerance: source?.length_tolerance ?? RECOMMENDED.length_tolerance,
  } as ToleranceValues;
}

export default function StepAnomalyTolerances({ onNext, onBack, config }: StepAnomalyTolerancesProps) {
  const pairs = useMemo(() => resolveWizardRunPairs(config?.summaryData), [config?.summaryData]);
  const primaryPair = useMemo(() => primaryWizardRunPair(config?.summaryData), [config?.summaryData]);
  const hasMultiplePairs = pairs.length > 1;

  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const activePair = pairs.find((pair) => pair.key === activePairKey) ?? primaryPair ?? pairs[0] ?? null;

  // Most operators want one setting for the whole session, so per-pair editing
  // stays off until it is needed — otherwise a 5-run chain would demand five
  // identical set-ups before the wizard could continue.
  const storedPerPair = config?.pairToleranceConfigs;
  const [perPairEnabled, setPerPairEnabled] = useState(
    () => Object.keys(storedPerPair || {}).length > 1,
  );

  const [byPair, setByPair] = useState<Record<string, ToleranceValues>>(() => {
    const shared = toleranceValues(config?.ToleranceConfig, config?.scenario?.distThresh);
    return Object.fromEntries(
      resolveWizardRunPairs(config?.summaryData).map((pair) => [
        pair.key,
        toleranceValues(storedPerPair?.[pair.key] ?? config?.ToleranceConfig, config?.scenario?.distThresh) ?? shared,
      ]),
    );
  });

  const activeKey = activePair?.key ?? '';
  const current = byPair[activeKey] ?? toleranceValues(config?.ToleranceConfig, config?.scenario?.distThresh);

  /** Write a field to the active pair, or to every pair while sharing is on. */
  const patch = (change: Partial<ToleranceValues>) => {
    setByPair((currentMap) => {
      if (!perPairEnabled) {
        return Object.fromEntries(
          Object.entries(currentMap).map(([key, value]) => [key, { ...value, ...change }]),
        );
      }
      return { ...currentMap, [activeKey]: { ...(currentMap[activeKey] ?? current), ...change } };
    });
  };

  const clockTol = current.clock_tolerance;
  const usGwTol = current.us_gw_distance_tolerance;
  const dsGwTol = current.ds_gw_distance_tolerance;
  const useUsGwDistance = current.use_us_gw_distance;
  const lengthTol = current.length_tolerance;

  const setClockTol = (value: number) => patch({ clock_tolerance: value });
  const setUsGwTol = (value: number) => patch({ us_gw_distance_tolerance: value });
  const setDsGwTol = (value: number) => patch({ ds_gw_distance_tolerance: value });
  const setUseUsGwDistance = (value: boolean) => patch({ use_us_gw_distance: value });
  const setLengthTol = (value: number) => patch({ length_tolerance: value });

  const applyRecommended = () => patch({ ...RECOMMENDED });

  const handleNext = () => {
    const primaryValues = (primaryPair && byPair[primaryPair.key]) || current;
    onNext({
      // The unscoped field still describes the primary pair, so the engines and
      // any session saved by an older client keep resolving one tolerance set.
      ToleranceConfig: primaryValues,
      pairToleranceConfigs: pairs.length > 0
        ? Object.fromEntries(pairs.map((pair) => [pair.key, byPair[pair.key] ?? current]))
        : undefined,
    });
  };

  return (
    <div className="alignment-surface bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-gray-100 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-brand-50 text-brand-600 rounded-xl">
          <FiSliders size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Anomaly Matching Tolerances</h2>
          <p className="text-sm text-gray-500">Configure parameters for the Hungarian Anomaly matcher.</p>
        </div>
      </div>

      {/* A 14-year interval and a 2-year interval rarely deserve the same
          tolerances, but demanding a separate set-up per pair by default would
          be busywork on a chain of five runs. */}
      {hasMultiplePairs && (
        <div className="mb-6 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-gray-800">Toleransi per pasangan run</h3>
              <p className="mt-0.5 text-xs text-gray-600">
                {perPairEnabled
                  ? 'Tiap pasangan memakai toleransinya sendiri. Pilih pasangan di bawah untuk mengaturnya.'
                  : `Satu set toleransi dipakai untuk ${pairs.length} pasangan. Aktifkan bila rentang tahunnya berbeda jauh.`}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={perPairEnabled}
              aria-label="Atur toleransi terpisah untuk tiap pasangan run"
              onClick={() => setPerPairEnabled((value) => !value)}
              className={`relative h-6 w-12 shrink-0 rounded-full shadow-inner transition-colors ${perPairEnabled ? 'bg-brand-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-md transition-transform ${perPairEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>

          {perPairEnabled && (
            <div className="mt-3 flex flex-wrap gap-2">
              {pairs.map((pair) => (
                <button
                  key={pair.key}
                  type="button"
                  aria-pressed={pair.key === activePair?.key}
                  onClick={() => setActivePairKey(pair.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    pair.key === activePair?.key
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'border border-brand-200 bg-white text-brand-700 hover:bg-brand-100'
                  }`}
                >
                  {pair.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5 mb-8 flex justify-between items-center">
        <div className="flex gap-3 items-center">
          <FiAward className="text-blue-600 text-2xl" />
          <div>
            <h3 className="font-semibold text-blue-900 text-sm">Industry Standard Recommendations</h3>
            <p className="text-xs text-blue-700 mt-1">Applying these defaults yields the highest confidence for standard MFL tool comparisons.</p>
          </div>
        </div>
        <button 
          onClick={applyRecommended}
          className="px-4 py-2 bg-white text-blue-700 text-sm font-semibold rounded-lg border border-blue-200 shadow-sm hover:bg-blue-50 transition-colors"
        >
          Use Recommended
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        
        {/* Clock Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">Clock Tolerance (deg)</label>
            <span className="bg-white px-2 py-1 rounded text-blue-600 font-mono text-sm shadow-sm border border-gray-100">{clockTol}°</span>
          </div>
          <input 
            type="range" min="5" max="45" step="1" 
            value={clockTol} onChange={(e) => setClockTol(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-2"
          />
          <p className="text-xs text-gray-500">Hard gate circular: kandidat ditolak jika selisih O&apos;Clock melebihi nilai ini. Clock yang kosong tidak otomatis ditolak.</p>
        </div>

        {/* US GW Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">US GW Distance Tol (± m)</label>
            <span className={`bg-white px-2 py-1 rounded font-mono text-sm shadow-sm border border-gray-100 ${useUsGwDistance ? 'text-blue-600' : 'text-gray-400'}`}>{usGwTol}m</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <input
              id="use-us-gw-distance"
              type="checkbox"
              checked={useUsGwDistance}
              onChange={(event) => setUseUsGwDistance(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              aria-describedby="use-us-gw-distance-help"
            />
            <label htmlFor="use-us-gw-distance" className="text-xs font-semibold text-gray-700 cursor-pointer">
              Gunakan Dist. U/S GW untuk matching
            </label>
          </div>
          <input 
            type="range" min="0.05" max="2.0" step="0.05" 
            value={usGwTol} onChange={(e) => setUsGwTol(parseFloat(e.target.value))}
            disabled={!useUsGwDistance}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p id="use-us-gw-distance-help" className="text-xs text-gray-500">
            {useUsGwDistance
              ? 'Hanya gunakan jika nilai Dist. U/S GW tersedia dan dapat dipercaya.'
              : 'Nonaktif: nilai Dist. U/S GW diabaikan; batas posisi U/S dan D/S tetap digunakan.'}
          </p>
        </div>

        {/* DS GW Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">DS GW Distance Tol (± m)</label>
            <span className="bg-white px-2 py-1 rounded text-blue-600 font-mono text-sm shadow-sm border border-gray-100">{dsGwTol}m</span>
          </div>
          <input 
            type="range" min="0.05" max="2.0" step="0.05" 
            value={dsGwTol} onChange={(e) => setDsGwTol(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-2"
          />
        </div>

        {/* Length Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">Length Tolerance (± mm)</label>
            <span className="bg-white px-2 py-1 rounded text-blue-600 font-mono text-sm shadow-sm border border-gray-100">{lengthTol}mm</span>
          </div>
          <input 
            type="range" min="5" max="200" step="5" 
            value={lengthTol} onChange={(e) => setLengthTol(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-2"
          />
          <p className="text-xs text-gray-500">Hard gate: kandidat ditolak jika selisih length melebihi nilai ini.</p>
        </div>

      </div>

      <p className="mb-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Depth tidak dipakai untuk memilih pasangan. Setelah Hungarian selesai, depth NEW yang lebih kecil dari OLD ditandai sebagai validasi fisika untuk review.
      </p>

      <div className="flex justify-between border-t border-gray-100 pt-6">
        <button 
          onClick={onBack}
          className="px-6 py-3 rounded-xl font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <FiChevronLeft /> Simulator Settings
        </button>
        <button 
          onClick={handleNext}
          className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-theme-md"
        >
          Execute Hungarian Matcher <FiChevronRight />
        </button>
      </div>
    </div>
  );
}
