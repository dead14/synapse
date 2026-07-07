import React from 'react';
import { FiPieChart, FiInfo, FiChevronRight } from 'react-icons/fi';

interface StepDataSummaryProps {
  onNext: () => void;
}

export default function StepDataSummary({ onNext }: StepDataSummaryProps) {
  // Mock data representing the initial read from the uploaded ILI data
  const dataSummary = {
    newRun: { name: '2025 MFL Inspection', total: 4835, anomalies: 3498, welds: 1136, valves: 5, tees: 5, offtakes: 14, bends: 34, others: 143 },
    oldRun: { name: '2020 MFL Inspection', total: 1538, anomalies: 253, welds: 1088, valves: 5, tees: 6, offtakes: 15, bends: 12, others: 159 }
  };

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
          <FiPieChart size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Data Extraction Summary</h2>
          <p className="text-sm text-gray-500">Pipeline features extracted from uploaded files.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* NEW Run Card */}
        <div className="border border-gray-100 rounded-2xl p-6 bg-gradient-to-br from-white to-gray-50">
          <div className="flex justify-between items-center mb-4">
             <h3 className="font-bold text-gray-800">Current Run</h3>
             <span className="text-xs font-bold px-2 py-1 bg-green-100 text-green-700 rounded-md">NEW</span>
          </div>
          <p className="text-sm text-gray-500 mb-6 font-medium">{dataSummary.newRun.name}</p>
          
          <div className="space-y-4">
            <div className="flex justify-between items-end border-b border-gray-100 pb-2">
              <span className="text-gray-600">Total Features</span>
              <span className="text-xl font-bold text-gray-800">{dataSummary.newRun.total.toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Metal Loss</span><span className="font-semibold">{dataSummary.newRun.anomalies}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Welds</span><span className="font-semibold">{dataSummary.newRun.welds}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Valves & Tees</span><span className="font-semibold">{dataSummary.newRun.valves + dataSummary.newRun.tees}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Offtakes</span><span className="font-semibold">{dataSummary.newRun.offtakes}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Bends</span><span className="font-semibold">{dataSummary.newRun.bends}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Others</span><span className="font-semibold">{dataSummary.newRun.others}</span></div>
            </div>
          </div>
        </div>

        {/* OLD Run Card */}
        <div className="border border-gray-100 rounded-2xl p-6 bg-gradient-to-br from-white to-gray-50">
          <div className="flex justify-between items-center mb-4">
             <h3 className="font-bold text-gray-800">Reference Run</h3>
             <span className="text-xs font-bold px-2 py-1 bg-blue-100 text-blue-700 rounded-md">OLD</span>
          </div>
          <p className="text-sm text-gray-500 mb-6 font-medium">{dataSummary.oldRun.name}</p>
          
          <div className="space-y-4">
            <div className="flex justify-between items-end border-b border-gray-100 pb-2">
              <span className="text-gray-600">Total Features</span>
              <span className="text-xl font-bold text-gray-800">{dataSummary.oldRun.total.toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Metal Loss</span><span className="font-semibold">{dataSummary.oldRun.anomalies}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Welds</span><span className="font-semibold">{dataSummary.oldRun.welds}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Valves & Tees</span><span className="font-semibold">{dataSummary.oldRun.valves + dataSummary.oldRun.tees}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Offtakes</span><span className="font-semibold">{dataSummary.oldRun.offtakes}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Bends</span><span className="font-semibold">{dataSummary.oldRun.bends}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Others</span><span className="font-semibold">{dataSummary.oldRun.others}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-yellow-50 p-4 rounded-xl flex gap-3 text-yellow-800 text-sm items-start mb-6 border border-yellow-200/50">
        <FiInfo className="shrink-0 mt-0.5 text-yellow-600" />
        <p>Please note the significant difference in total features. The NEW run reported 3x more anomalies. We recommend hiding non-critical features in the next step to improve alignment accuracy.</p>
      </div>

      <div className="flex justify-end">
        <button 
          onClick={onNext}
          className="bg-gray-900 hover:bg-black text-white px-8 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-md shadow-gray-900/20"
        >
          Configure Scenario <FiChevronRight />
        </button>
      </div>
    </div>
  );
}
