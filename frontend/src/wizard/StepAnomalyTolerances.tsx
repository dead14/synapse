import React, { useState } from 'react';
import { FiSliders, FiChevronRight, FiChevronLeft, FiAward, FiAlertCircle } from 'react-icons/fi';

interface StepAnomalyTolerancesProps {
  onNext: (config: any) => void;
  onBack: () => void;
}

export default function StepAnomalyTolerances({ onNext, onBack }: StepAnomalyTolerancesProps) {
  const [clockTol, setClockTol] = useState(15);
  const [distGwTol, setDistGwTol] = useState(0.2);
  const [depthGrowthMax, setDepthGrowthMax] = useState(25); // Max lateral growth %WT
  
  const applyRecommended = () => {
    setClockTol(15);
    setDistGwTol(0.2);
    setDepthGrowthMax(25);
  };

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-orange-50 text-orange-600 rounded-xl">
          <FiSliders size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Anomaly Matching Tolerances</h2>
          <p className="text-sm text-gray-500">Configure parameters for the Hungarian Anomaly matcher and Naive Bayes validation.</p>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        
        {/* Clock Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-orange-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">Clock Tolerance (± degrees)</label>
            <span className="bg-white px-2 py-1 rounded text-orange-600 font-mono text-sm shadow-sm border border-gray-100">{clockTol}°</span>
          </div>
          <input 
            type="range" min="5" max="45" step="5" 
            value={clockTol} onChange={(e) => setClockTol(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500 mb-4"
          />
          <p className="text-xs text-gray-500">Maximum allowed rotation offset between Run 1 and Run 2 anomalies.</p>
          {clockTol > 20 && (
            <p className="text-xs text-red-500 mt-2 flex items-center gap-1"><FiAlertCircle/> High risk of false positives</p>
          )}
        </div>

        {/* Dist GW Tolerance */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-orange-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">Dist. to GW Tolerance (± m)</label>
            <span className="bg-white px-2 py-1 rounded text-orange-600 font-mono text-sm shadow-sm border border-gray-100">{distGwTol}m</span>
          </div>
          <input 
            type="range" min="0.05" max="1.0" step="0.05" 
            value={distGwTol} onChange={(e) => setDistGwTol(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500 mb-4"
          />
          <p className="text-xs text-gray-500">Maximum axial distance variation relative to the upstream Girth Weld.</p>
        </div>

        {/* Depth Growth Cap */}
        <div className="border border-gray-200 rounded-xl p-5 hover:border-orange-300 transition-colors bg-gray-50/50">
          <div className="flex justify-between items-start mb-4">
            <label className="text-sm font-bold text-gray-700">Max Depth Growth (% WT)</label>
            <span className="bg-white px-2 py-1 rounded text-orange-600 font-mono text-sm shadow-sm border border-gray-100">{depthGrowthMax}%</span>
          </div>
          <input 
            type="range" min="10" max="60" step="5" 
            value={depthGrowthMax} onChange={(e) => setDepthGrowthMax(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500 mb-4"
          />
          <p className="text-xs text-gray-500">Threshold for flagging suspicious abnormal lateral growth rates in physics validation.</p>
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
          onClick={() => onNext({ clockTol, distGwTol, depthGrowthMax })}
          className="bg-orange-600 hover:bg-orange-700 text-gray-900 px-8 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-md shadow-orange-600/20"
        >
          Execute Hungarian Matcher <FiChevronRight />
        </button>
      </div>
    </div>
  );
}
