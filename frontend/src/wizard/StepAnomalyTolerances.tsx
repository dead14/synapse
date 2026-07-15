import { useState, useEffect } from 'react';
import { FiSliders, FiChevronRight, FiChevronLeft, FiAward, FiAlertCircle } from 'react-icons/fi';

interface StepAnomalyTolerancesProps {
  onNext: (config: any) => void;
  onBack: () => void;
  config?: any;
}

export default function StepAnomalyTolerances({ onNext, onBack, config }: StepAnomalyTolerancesProps) {
  const [clockTol, setClockTol] = useState(config?.ToleranceConfig?.clock_tolerance ?? 15);
  const [usGwTol, setUsGwTol] = useState(config?.ToleranceConfig?.us_gw_distance_tolerance ?? config?.scenario?.distThresh ?? 0.2);
  const [dsGwTol, setDsGwTol] = useState(config?.ToleranceConfig?.ds_gw_distance_tolerance ?? config?.scenario?.distThresh ?? 0.2);
  const [depthTol, setDepthTol] = useState(config?.ToleranceConfig?.depth_tolerance ?? 10);
  const [lengthTol, setLengthTol] = useState(config?.ToleranceConfig?.length_tolerance ?? 50);
  
  const applyRecommended = () => {
    setClockTol(15);
    setUsGwTol(0.2);
    setDsGwTol(0.2);
    setDepthTol(10);
    setLengthTol(50);
  };

  const handleNext = () => {
    onNext({
      ToleranceConfig: {
        clock_tolerance: clockTol,
        us_gw_distance_tolerance: usGwTol,
        ds_gw_distance_tolerance: dsGwTol,
        depth_tolerance: depthTol,
        length_tolerance: lengthTol
      }
    });
  };

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
          <FiSliders size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Anomaly Matching Tolerances</h2>
          <p className="text-sm text-gray-500">Configure parameters for the Hungarian Anomaly matcher.</p>
        </div>
      </div>

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
            <label className="text-sm font-bold text-gray-700">Clock Tolerance (± deg)</label>
            <span className="bg-white px-2 py-1 rounded text-blue-600 font-mono text-sm shadow-sm border border-gray-100">{clockTol}°</span>
          </div>
          <input 
            type="range" min="5" max="45" step="1" 
            value={clockTol} onChange={(e) => setClockTol(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-2"
          />
        </div>

        {/* US GW Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">US GW Distance Tol (± m)</label>
            <span className="bg-white px-2 py-1 rounded text-blue-600 font-mono text-sm shadow-sm border border-gray-100">{usGwTol}m</span>
          </div>
          <input 
            type="range" min="0.05" max="2.0" step="0.05" 
            value={usGwTol} onChange={(e) => setUsGwTol(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 mb-2"
          />
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

        {/* Depth Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">Depth Tolerance (± %WT)</label>
            <span className="bg-white px-2 py-1 rounded text-blue-600 font-mono text-sm shadow-sm border border-gray-100">{depthTol}%</span>
          </div>
          <input 
            type="range" min="1" max="50" step="1" 
            value={depthTol} onChange={(e) => setDepthTol(parseInt(e.target.value))}
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
        </div>

      </div>

      <div className="flex justify-between border-t border-gray-100 pt-6">
        <button 
          onClick={onBack}
          className="px-6 py-3 rounded-xl font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
        >
          <FiChevronLeft /> Simulator Settings
        </button>
        <button 
          onClick={handleNext}
          className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-md shadow-blue-600/20"
        >
          Execute Hungarian Matcher <FiChevronRight />
        </button>
      </div>
    </div>
  );
}
