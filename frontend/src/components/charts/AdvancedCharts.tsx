import { useState } from 'react';
import { FiX } from 'react-icons/fi';
import Modal from '../common/Modal';
import DepthVsDistanceChart from './DepthVsDistanceChart';
import OrientationVsDistanceChart from './OrientationVsDistanceChart';
import CrVsDistanceChart from './CrVsDistanceChart';
import CrDistributionChart from './CrDistributionChart';

interface AdvancedChartsProps {
  data: any[];
  onClose: () => void;
}

export default function AdvancedCharts({ data, onClose }: AdvancedChartsProps) {
  const [activeTab, setActiveTab] = useState('DepthVsDistance');
  
  // Filter States
  const [matchedFilter, setMatchedFilter] = useState('Both'); // Run 1, Run 2, Both, Hide
  const [unmatchedFilter, setUnmatchedFilter] = useState('Both');
  const [depthType, setDepthType] = useState('Absolute'); // Absolute, Percentage
  const [defectTypes, setDefectTypes] = useState({ internal: true, external: true });
  const [multiMatchOnly, setMultiMatchOnly] = useState(false);
  const [visualType, setVisualType] = useState('Points'); // Points, Rectangles
  const [binSize, setBinSize] = useState(0.2);
  const [maxCr, setMaxCr] = useState(2);
  const [minCr, setMinCr] = useState(-2);

  return (
    <Modal
      onClose={onClose}
      labelledBy="advanced-analytics-title"
      closeOnBackdrop={false}
      overlayClassName="fixed inset-0 z-[999999]"
      panelClassName="h-full w-full bg-white flex flex-col font-sans overflow-hidden animate-fade-in"
    >
      <div className="w-full h-full flex flex-col overflow-hidden">

        {/* Premium Header */}
        <div className="flex justify-between items-center px-8 py-5 border-b border-gray-100 bg-white/50 backdrop-blur-md flex-shrink-0">
          <div>
            <h2 id="advanced-analytics-title" className="text-xl font-bold text-gray-800">Advanced Analytics</h2>
            <p className="text-sm text-gray-500 mt-0.5">Defect & CR Matching Overview</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close advanced analytics"
            className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-2.5 rounded-full transition-all duration-300"
          >
            <FiX size={24} />
          </button>
        </div>

        {/* Main Layout - scrollable */}
        <div className="flex flex-col flex-1 overflow-y-auto bg-[#f8f9fc] p-6 gap-6">
          
          {/* Segmented Control Tabs */}
          <div className="flex bg-white p-1.5 rounded-xl shadow-sm border border-gray-100 mx-auto">
            {[
              { id: 'DepthVsDistance', label: 'Flaw match depth vs distance' },
              { id: 'OrientationVsDistance', label: 'Flaw orientation vs distance' },
              { id: 'CrVsDistance', label: 'CR vs distance' },
              { id: 'CrDistribution', label: 'CR distribution' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-theme-md'
                    : 'bg-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Chart Area */}
          <div className="flex-1 bg-white rounded-[20px] shadow-sm border border-gray-100 relative p-6 flex flex-col w-full">
             {activeTab === 'DepthVsDistance' ? (
                <DepthVsDistanceChart 
                   data={data} 
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     depthType: depthType,
                     multiMatchOnly,
                     defectTypes
                   }} 
                />
             ) : activeTab === 'OrientationVsDistance' ? (
                <OrientationVsDistanceChart
                   data={data}
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     multiMatchOnly,
                     defectTypes,
                     visualType
                   }}
                />
             ) : activeTab === 'CrVsDistance' ? (
                <CrVsDistanceChart
                   data={data}
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     defectTypes
                   }}
                />
             ) : activeTab === 'CrDistribution' ? (
                <CrDistributionChart
                   data={data}
                   filters={{
                     matched: matchedFilter,
                     unmatched: unmatchedFilter,
                     defectTypes,
                     binSize,
                     maxCr,
                     minCr
                   }}
                />
             ) : (
               <div className="flex-1 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-400">
                  [ {activeTab} Chart Placeholder ]
               </div>
             )}
          </div>

          {/* Filters Panel (Lower Pane) */}
          <div className="bg-white rounded-[20px] shadow-sm border border-gray-100 p-6 grid grid-cols-1 md:grid-cols-4 gap-8 w-full shrink-0">
            
            {/* Matched ILI Data */}
            <div className="flex flex-col">
              <h4 className="font-bold text-gray-800 text-sm mb-4">Matched ILI data</h4>
              <div className="flex flex-col gap-3 text-sm">
                {['Run 1', 'Run 2', 'Both', 'Hide'].map(val => (
                  <label key={`m-${val}`} className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${matchedFilter === val ? 'border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                      {matchedFilter === val && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                    </div>
                    <input type="radio" className="hidden" checked={matchedFilter === val} onChange={() => setMatchedFilter(val)} />
                    <span className="text-gray-600 group-hover:text-gray-900">{val === 'Hide' ? 'Do not display' : val === 'Run 1' ? 'Run 1 (Old)' : val === 'Run 2' ? 'Run 2 (New)' : 'Both'}</span>
                  </label>
                ))}
              </div>
              
              {activeTab !== 'CrVsDistance' && activeTab !== 'CrDistribution' && (
                <>
                  <div className="h-px bg-gray-100 my-4" />
                  <h4 className="font-bold text-gray-800 text-sm mb-4">Multi match</h4>
                  <label className="flex items-center gap-3 cursor-pointer group text-sm">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${multiMatchOnly ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400 bg-white'}`}>
                      {multiMatchOnly && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    <input type="checkbox" className="hidden" checked={multiMatchOnly} onChange={e => setMultiMatchOnly(e.target.checked)} />
                    <span className="text-gray-600 group-hover:text-gray-900">Multi match only</span>
                  </label>
                </>
              )}
            </div>

            {/* Unmatched ILI Data */}
            <div className="flex flex-col">
              <h4 className="font-bold text-gray-800 text-sm mb-4">Unmatched ILI data</h4>
              <div className="flex flex-col gap-3 text-sm">
                {['Run 1', 'Run 2', 'Both', 'Hide'].map(val => (
                  <label key={`um-${val}`} className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${unmatchedFilter === val ? 'border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                      {unmatchedFilter === val && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                    </div>
                    <input type="radio" className="hidden" checked={unmatchedFilter === val} onChange={() => setUnmatchedFilter(val)} />
                    <span className="text-gray-600 group-hover:text-gray-900">{val === 'Hide' ? 'Do not display' : val === 'Run 1' ? 'Run 1 (Old)' : val === 'Run 2' ? 'Run 2 (New)' : 'Both'}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Depth & Defect Types */}
            <div className="flex flex-col">
              {activeTab === 'DepthVsDistance' && (
                <>
                  <h4 className="font-bold text-gray-800 text-sm mb-4">Depth</h4>
                  <div className="flex flex-col gap-3 text-sm mb-6">
                    {['Absolute', 'Percentage'].map(val => (
                      <label key={`depth-${val}`} className="flex items-center gap-3 cursor-pointer group">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${depthType === val ? 'border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                          {depthType === val && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                        </div>
                        <input type="radio" className="hidden" checked={depthType === val} onChange={() => setDepthType(val)} />
                        <span className="text-gray-600 group-hover:text-gray-900">{val === 'Percentage' ? 'Percentage of WT' : 'Absolute'}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              <h4 className="font-bold text-gray-800 text-sm mb-4">Defect types</h4>
              <div className="flex flex-col gap-3 text-sm">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${defectTypes.internal ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400 bg-white'}`}>
                    {defectTypes.internal && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <input type="checkbox" className="hidden" checked={defectTypes.internal} onChange={e => setDefectTypes({...defectTypes, internal: e.target.checked})} />
                  <span className="text-gray-600 group-hover:text-gray-900">Internal</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${defectTypes.external ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400 bg-white'}`}>
                    {defectTypes.external && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <input type="checkbox" className="hidden" checked={defectTypes.external} onChange={e => setDefectTypes({...defectTypes, external: e.target.checked})} />
                  <span className="text-gray-600 group-hover:text-gray-900">External</span>
                </label>
              </div>
            </div>

            {/* Type & Histogram settings */}
            <div className="flex flex-col">
              {(activeTab === 'OrientationVsDistance' || activeTab === 'CrDistribution') && (
                <>
                  <h4 className="font-bold text-gray-800 text-sm mb-4">
                    {activeTab === 'OrientationVsDistance' ? 'Type' : 'Histogram Settings'}
                  </h4>
                  {activeTab === 'OrientationVsDistance' ? (
                    <div className="flex flex-col gap-3 text-sm">
                      {['Points', 'Rectangles'].map(val => (
                        <label key={`vis-${val}`} className="flex items-center gap-3 cursor-pointer group">
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${visualType === val ? 'border-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                            {visualType === val && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                          </div>
                          <input type="radio" className="hidden" checked={visualType === val} onChange={() => setVisualType(val)} />
                          <span className="text-gray-600 group-hover:text-gray-900">{val}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 text-sm bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <label className="flex items-center justify-between text-gray-600">
                        Bin size: 
                        <div className="flex items-center">
                          <input type="number" step="0.1" value={binSize} onChange={e => setBinSize(parseFloat(e.target.value) || 0.2)} className="w-16 border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800 focus:outline-none focus:border-blue-400 text-right font-medium shadow-sm" />
                          <span className="ml-2 text-xs text-gray-400">mm/yr</span>
                        </div>
                      </label>
                      <label className="flex items-center justify-between text-gray-600">
                        Maximum: 
                        <div className="flex items-center">
                          <input type="number" value={maxCr} onChange={e => setMaxCr(parseFloat(e.target.value) || 2)} className="w-16 border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800 focus:outline-none focus:border-blue-400 text-right font-medium shadow-sm" />
                          <span className="ml-2 text-xs text-gray-400">mm/yr</span>
                        </div>
                      </label>
                      <label className="flex items-center justify-between text-gray-600">
                        Minimum: 
                        <div className="flex items-center">
                          <input type="number" value={minCr} onChange={e => setMinCr(parseFloat(e.target.value) || -2)} className="w-16 border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-800 focus:outline-none focus:border-blue-400 text-right font-medium shadow-sm" />
                          <span className="ml-2 text-xs text-gray-400">mm/yr</span>
                        </div>
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
            
          </div>
        </div>
      </div>
    </Modal>
  );
}
