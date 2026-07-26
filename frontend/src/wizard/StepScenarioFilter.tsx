import { useState } from 'react';
import { FiFilter, FiSettings, FiChevronRight, FiChevronLeft, FiEye, FiEyeOff } from 'react-icons/fi';

interface StepScenarioFilterProps {
  onNext: (config: any) => void;
  onBack: () => void;
}

export default function StepScenarioFilter({ onNext, onBack, config: _config }: StepScenarioFilterProps & { config?: any }) {
  const [distThresh, setDistThresh] = useState(0.3);
  
  const [hiddenFeatures, setHiddenFeatures] = useState({
    offtake: true,
    tee: true,
    bend: false,
    support: true,
    marker: false
  });

  const toggleFeature = (key: keyof typeof hiddenFeatures) => {
    setHiddenFeatures(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="feature-rules-console alignment-surface bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-gray-100 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-brand-50 text-brand-600 rounded-xl">
          <FiSettings size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Scenario Assessment</h2>
          <p className="text-sm text-gray-500">Configure matching thresholds and filter out non-essential data.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        
        {/* Global Thresholds */}
        <div>
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            Matching Parameters
          </h3>
          <div className="space-y-5 bg-gray-50 p-6 rounded-2xl border border-gray-100">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">Distance Matching Threshold (m)</label>
                <span className="text-sm font-mono text-brand-600">{distThresh}m</span>
              </div>
              <input 
                type="range" min="0.1" max="2.0" step="0.1" 
                value={distThresh} onChange={(e) => setDistThresh(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
              />
            </div>

            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
              Depth tidak memfilter kandidat. Nilainya diperiksa setelah Hungarian untuk menandai penurunan depth yang tidak sesuai ekspektasi pertumbuhan corrosion.
            </p>
          </div>
        </div>

        {/* Feature Filters */}
        <div>
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <FiFilter className="text-gray-500" /> Data Cleansing (Hide Features)
          </h3>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Feature Type</th>
                  <th className="px-4 py-3 font-medium text-right">Visibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(hiddenFeatures).map(([key, isHidden]) => (
                  <tr key={key} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-700 capitalize">{key}</td>
                    <td className="px-4 py-3 text-right">
                      <button 
                        onClick={() => toggleFeature(key as any)}
                        className={`px-3 py-1.5 rounded-lg flex items-center gap-2 ml-auto transition-colors ${
                          isHidden 
                            ? 'bg-red-50 text-red-600 border border-red-100' 
                            : 'bg-green-50 text-green-600 border border-green-100'
                        }`}
                      >
                        {isHidden ? <><FiEyeOff /> Hidden</> : <><FiEye /> Visible</>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-4 leading-relaxed">
            By hiding non-essential landmark features (like Offtakes or Supports), the algorithm can focus on primary anchors (Valves, Welds, Tees), increasing alignment accuracy and reducing false positives.
          </p>
        </div>

      </div>

      <div className="flex justify-between border-t border-gray-100 pt-6">
        <button 
          onClick={onBack}
          className="px-6 py-3 rounded-xl font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <FiChevronLeft /> Back
        </button>
          <button 
            onClick={() => onNext({ distThresh, hiddenFeatures })}
            className="px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl flex items-center gap-2 transition-colors shadow-theme-md"
          >
            Next <FiChevronRight />
          </button>
      </div>
    </div>
  );
}
