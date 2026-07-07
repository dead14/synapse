import React from 'react';
import { FiEye, FiDownload, FiSettings, FiBell, FiActivity, FiClock, FiCheckCircle } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

const mockRuns = [
  {
    id: 1,
    lineName: "MT-KLK Water Pipeline",
    date: "15 Oct 2026",
    status: "Completed",
    matchRate: "82.8%",
    anomalies: 1273,
    vendorOld: "Vendor Lama (2020)",
    vendorNew: "Vendor Baru (2025)"
  },
  {
    id: 2,
    lineName: "JKT-BDG Gas Segment",
    date: "10 Oct 2026",
    status: "Completed",
    matchRate: "91.2%",
    anomalies: 840,
    vendorOld: "Vendor A (2018)",
    vendorNew: "Vendor B (2023)"
  },
  {
    id: 3,
    lineName: "HU-CPA Crude Oil",
    date: "05 Oct 2026",
    status: "Completed",
    matchRate: "76.5%",
    anomalies: 2104,
    vendorOld: "Vendor X (2019)",
    vendorNew: "Vendor Y (2024)"
  }
];

export default function PipelineRuns() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex flex-col items-center pb-12">
      {/* Header Area */}
      <div className="w-full bg-white shadow-sm pb-6 pt-8 px-8 flex justify-center border-b border-gray-100">
        <div className="w-full max-w-6xl flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <span className="bg-[#1a2130] text-white p-2 rounded-xl"><FiActivity size={24} /></span>
              Pipeline Runs History
            </h1>
            <p className="text-gray-500 mt-2">Manage your previous ILI alignment runs, view data, or initiate Fitness For Service (FFS).</p>
          </div>
          <div className="flex gap-4">
            <button className="p-2 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors">
              <FiBell size={20} />
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors">
              <FiSettings size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="w-full max-w-6xl px-8 mt-8 flex flex-col gap-6">
        
        {/* Table Container */}
        <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-4 font-bold">Pipeline Line Name</th>
                  <th className="px-6 py-4 font-bold">Upload Date</th>
                  <th className="px-6 py-4 font-bold">Match Rate</th>
                  <th className="px-6 py-4 font-bold">Status</th>
                  <th className="px-6 py-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mockRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="font-bold text-gray-900 text-base">{run.lineName}</div>
                      <div className="text-xs text-gray-500 mt-1">{run.vendorOld} vs {run.vendorNew}</div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <FiClock className="text-gray-400" />
                        {run.date}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold text-gray-900">{run.matchRate}</span>
                        <span className="text-xs text-gray-500">{run.anomalies} anomalies</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                        <FiCheckCircle size={12} />
                        {run.status}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex justify-end gap-3 opacity-80 group-hover:opacity-100 transition-opacity">
                        
                        {/* Action: View Data */}
                        <button 
                          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
                          title="View Alignment Data"
                        >
                          <FiEye /> View
                        </button>
                        
                        {/* Action: Download */}
                        <a 
                          href="http://localhost:8000/download-report"
                          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 transition-colors"
                          title="Download Report"
                        >
                          <FiDownload /> Report
                        </a>

                        {/* Action: FFS */}
                        <button 
                          onClick={() => navigate('/ffs')}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-gray-900 bg-[#cfff2e] rounded-lg hover:bg-[#bfee1a] shadow-sm transition-colors"
                          title="Fitness For Service"
                        >
                          ⚙️ FFS
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination (Mock) */}
          <div className="bg-white px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">Showing <span className="font-medium text-gray-900">1</span> to <span className="font-medium text-gray-900">3</span> of <span className="font-medium text-gray-900">12</span> runs</span>
            <div className="flex gap-2">
              <button className="px-3 py-1 border border-gray-200 text-gray-400 rounded hover:bg-gray-50 disabled:opacity-50" disabled>Prev</button>
              <button className="px-3 py-1 border border-gray-200 bg-gray-50 text-gray-900 rounded font-medium">1</button>
              <button className="px-3 py-1 border border-gray-200 text-gray-600 rounded hover:bg-gray-50">2</button>
              <button className="px-3 py-1 border border-gray-200 text-gray-600 rounded hover:bg-gray-50">3</button>
              <button className="px-3 py-1 border border-gray-200 text-gray-600 rounded hover:bg-gray-50">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
