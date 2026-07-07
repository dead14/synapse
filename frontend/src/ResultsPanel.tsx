import React, { useState } from 'react';
import { FiSearch, FiFileText, FiSave } from 'react-icons/fi';

interface ResultsPanelProps {
  data: any[];
  loading: boolean;
}

export default function ResultsPanel({ data, loading }: ResultsPanelProps) {
  const [activeTab, setActiveTab] = useState('Results');
  const [radioFilter, setRadioFilter] = useState('All');
  const [unmatchedOld, setUnmatchedOld] = useState(false);
  const [unmatchedNew, setUnmatchedNew] = useState(true);
  
  // Interventions state
  const [run1Defect, setRun1Defect] = useState('');
  const [run2Defect, setRun2Defect] = useState('');
  const [interventionAction, setInterventionAction] = useState('-');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const tabs = ['Results', 'ILI Run 1', 'ILI Run 2', 'Interventions'];
  
  // Data extraction and pagination
  const actualData = (data && data.length > 1) ? data.slice(1) : [];
  const totalPages = Math.ceil(actualData.length / itemsPerPage) || 1;
  const currentData = actualData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Helper component for Pagination
  const PaginationFooter = () => (
    <div className="bg-gray-100 border-t border-gray-200 p-2 flex justify-between items-center text-sm text-gray-600">
      <div className="flex gap-1 items-center">
        <button 
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="px-2 py-1 bg-white border border-gray-300 rounded shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >&lt;</button>
        <span className="px-3 py-1 font-medium text-gray-700">
          Page {currentPage} of {totalPages}
        </span>
        <button 
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="px-2 py-1 bg-white border border-gray-300 rounded shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >&gt;</button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Total: {actualData.length} items</span>
        <span className="ml-4">Items per page:</span>
        <select 
          value={itemsPerPage} 
          onChange={(e) => {
            setItemsPerPage(Number(e.target.value));
            setCurrentPage(1);
          }}
          className="border border-gray-300 rounded py-1 px-2 bg-white cursor-pointer"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={500}>500</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden">
      
      {/* Tabs Header */}
      <div className="flex border-b border-gray-200 bg-gray-50/50">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab 
                ? 'border-blue-500 text-blue-600 bg-white' 
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Results' && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Filters Area */}
          <div className="p-4 bg-[#fffdf0] border-b border-gray-200 text-sm flex flex-col gap-3">
            <div className="flex gap-6 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="filter" checked={radioFilter === 'All'} onChange={() => setRadioFilter('All')} className="text-blue-500" />
                All
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="filter" checked={radioFilter === 'Distance'} onChange={() => setRadioFilter('Distance')} className="text-blue-500" />
                Distance
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="filter" checked={radioFilter === 'Chart'} onChange={() => setRadioFilter('Chart')} className="text-blue-500" />
                Chart
              </label>
            </div>
            <div className="flex gap-6 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={unmatchedOld} onChange={(e) => setUnmatchedOld(e.target.checked)} className="rounded text-blue-500" />
                Unmatched old
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={unmatchedNew} onChange={(e) => setUnmatchedNew(e.target.checked)} className="rounded text-blue-500" />
                Unmatched new
              </label>
            </div>
          </div>

          {/* Search Bar */}
          <div className="p-2 border-b border-gray-200 bg-white flex justify-between items-center">
            <div className="flex items-center text-blue-600 pl-2">
              <FiFileText size={18} />
              <span className="ml-1 text-xs cursor-pointer text-gray-400 font-bold border border-gray-300 rounded px-1 ml-2">x</span>
            </div>
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search" 
                className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Table Area */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-700 sticky top-0 border-b border-gray-200 shadow-sm z-10">
                <tr>
                  <th className="p-3 font-bold border-r border-gray-200">Run 1 Defect</th>
                  <th className="p-3 font-bold border-r border-gray-200">Abs. Distance 1 <span className="text-blue-500">m</span></th>
                  <th className="p-3 font-bold border-r border-gray-200">Depth 1 <span className="text-blue-500">mm</span></th>
                  <th className="p-3 font-bold border-r border-gray-200">Distance Adjusted <span className="text-blue-500">m</span></th>
                  <th className="p-3 font-bold border-r border-gray-200">Run 2 Defect</th>
                  <th className="p-3 font-bold border-r border-gray-200">Abs. Distance 2 <span className="text-blue-500">m</span></th>
                  <th className="p-3 font-bold border-r border-gray-200">Depth 2 <span className="text-blue-500">mm</span></th>
                  <th className="p-3 font-bold border-r border-gray-200">CR <span className="text-blue-500">mm/yr</span></th>
                  <th className="p-3 font-bold">Lateral Growth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={9} className="p-8 text-center text-gray-400">Loading data...</td></tr>
                ) : (
                  currentData.map((row: any, i: number) => {
                    const run1Defect = row['Unnamed: 29'] ?? '-';
                    const absDist1 = row['DATA LAMA 2020 (Vendor Lama)  >'];
                    const depth1 = row['Unnamed: 37'] ?? '-';
                    const run2Defect = row['Unnamed: 2'] ?? '-';
                    const absDist2 = row['<  DATA BARU 2025 (Vendor Baru)'];
                    const depth2 = row['Unnamed: 10'] ?? '-';
                    
                    const dist1Formatted = typeof absDist1 === 'number' ? absDist1.toFixed(3) : '-';
                    const dist2Formatted = typeof absDist2 === 'number' ? absDist2.toFixed(3) : '-';
                    const distAdj = typeof absDist1 === 'number' ? (absDist1 - 0.1).toFixed(3) : '-';
                    
                    const d1 = parseFloat(depth1);
                    const d2 = parseFloat(depth2);
                    const cr = (!isNaN(d1) && !isNaN(d2)) ? ((d2 - d1) / 5).toFixed(3) : '-';
                    const latGrowth = '-';

                    return (
                      <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                        <td className="p-3 border-r border-gray-100">{run1Defect}</td>
                        <td className="p-3 border-r border-gray-100">{dist1Formatted}</td>
                        <td className="p-3 border-r border-gray-100">{depth1}</td>
                        <td className="p-3 border-r border-gray-100 bg-gray-50">{distAdj}</td>
                        <td className="p-3 border-r border-gray-100">{run2Defect}</td>
                        <td className="p-3 border-r border-gray-100">{dist2Formatted}</td>
                        <td className="p-3 border-r border-gray-100 text-blue-500 font-medium">{depth2}</td>
                        <td className="p-3 border-r border-gray-100">{cr}</td>
                        <td className="p-3">{latGrowth}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          <PaginationFooter />
        </div>
      )}

      {(activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2') && (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-auto">
             <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-700 sticky top-0 border-b border-gray-200 shadow-sm z-10">
                   <tr>
                      <th className="p-3 font-bold border-r border-gray-200">Defect ID</th>
                      <th className="p-3 font-bold border-r border-gray-200">Distance</th>
                      <th className="p-3 font-bold border-r border-gray-200">Dist. Adjusted</th>
                      <th className="p-3 font-bold border-r border-gray-200">Rel. to U/S Weld</th>
                      <th className="p-3 font-bold border-r border-gray-200">Wall Thickness</th>
                      <th className="p-3 font-bold border-r border-gray-200">Orientation</th>
                      <th className="p-3 font-bold border-r border-gray-200">Length</th>
                      <th className="p-3 font-bold border-r border-gray-200">Width</th>
                      <th className="p-3 font-bold border-r border-gray-200">Depth</th>
                      <th className="p-3 font-bold border-r border-gray-200">Flaw Depth [%]</th>
                      <th className="p-3 font-bold">Wall Side</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                   {loading ? (
                     <tr><td colSpan={11} className="p-8 text-center text-gray-400">Loading data...</td></tr>
                   ) : (
                     currentData.map((row: any, i: number) => {
                       const isOld = activeTab === 'ILI Run 1';
                       
                       const defectId = row[isOld ? 'Unnamed: 29' : 'Unnamed: 2'] ?? '-';
                       const distance = row[isOld ? 'DATA LAMA 2020 (Vendor Lama)  >' : '<  DATA BARU 2025 (Vendor Baru)'];
                       const distGw = row[isOld ? 'Unnamed: 32' : 'Unnamed: 5'] ?? '-';
                       const wt = row[isOld ? 'Unnamed: 33' : 'Unnamed: 6'] ?? '-';
                       const oclock = row[isOld ? 'Unnamed: 34' : 'Unnamed: 7'] ?? '-';
                       const length = row[isOld ? 'Unnamed: 35' : 'Unnamed: 8'] ?? '-';
                       const width = row[isOld ? 'Unnamed: 36' : 'Unnamed: 9'] ?? '-';
                       const depth = row[isOld ? 'Unnamed: 37' : 'Unnamed: 10'] ?? '-';
                       const surface = row[isOld ? 'Unnamed: 38' : 'Unnamed: 11'] ?? '-';
                       
                       const distFormatted = typeof distance === 'number' ? distance.toFixed(3) : '-';
                       const distAdj = typeof distance === 'number' ? (distance - 0.1).toFixed(3) : '-';

                       return (
                         <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                            <td className="p-3 border-r border-gray-100">{defectId}</td>
                            <td className="p-3 border-r border-gray-100">{distFormatted}</td>
                            <td className="p-3 border-r border-gray-100 bg-gray-50">{distAdj}</td>
                            <td className="p-3 border-r border-gray-100">{distGw}</td>
                            <td className="p-3 border-r border-gray-100">{wt}</td>
                            <td className="p-3 border-r border-gray-100">{oclock}</td>
                            <td className="p-3 border-r border-gray-100">{length}</td>
                            <td className="p-3 border-r border-gray-100">{width}</td>
                            <td className="p-3 border-r border-gray-100">{depth}</td>
                            <td className="p-3 border-r border-gray-100">{depth}%</td>
                            <td className="p-3 text-blue-600 font-medium">{surface}</td>
                         </tr>
                       );
                     })
                   )}
                </tbody>
             </table>
          </div>
        </div>
      )}

      {activeTab === 'Interventions' && (
        <div className="flex-1 p-6 bg-gray-50 overflow-auto flex flex-col gap-6">
          {/* Intervention Form Modal Replica */}
          <div className="max-w-xl bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden animate-fade-in w-full">
             <div className="bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center">
                <h3 className="text-lg font-bold text-blue-500">Intervention</h3>
                <button className="text-gray-400 hover:text-gray-600 bg-gray-100 px-2 py-0.5 rounded shadow-sm">x</button>
             </div>
             
             <div className="p-6 space-y-4">
                <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                   <label className="text-sm font-bold text-gray-700">Run 1 Defect</label>
                   <input 
                      type="text" 
                      value={run1Defect}
                      onChange={(e) => setRun1Defect(e.target.value)}
                      className="border border-gray-300 rounded px-3 py-1.5 bg-[#fff8c4] focus:outline-none focus:border-blue-400 w-full"
                   />
                </div>
                
                <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                   <label className="text-sm font-bold text-gray-700">Run 2 Defect</label>
                   <input 
                      type="text" 
                      value={run2Defect}
                      onChange={(e) => setRun2Defect(e.target.value)}
                      className="border border-gray-300 rounded px-3 py-1.5 bg-[#fff8c4] focus:outline-none focus:border-blue-400 w-full"
                   />
                </div>

                <div className="grid grid-cols-[120px_1fr] items-center gap-4">
                   <label className="text-sm font-bold text-gray-700">Action</label>
                   <select 
                      value={interventionAction}
                      onChange={(e) => setInterventionAction(e.target.value)}
                      className="border border-gray-300 rounded px-3 py-1.5 bg-white focus:outline-none focus:border-blue-400 w-full"
                   >
                      <option value="-">-</option>
                      <option value="Match">Matched</option>
                      <option value="Unmatch">Unmatched</option>
                   </select>
                </div>
             </div>

             <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center gap-3">
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 shadow-sm">
                   <FiSave /> Save
                </button>
                <span className="text-gray-500 text-sm">or</span>
                <button className="text-red-500 hover:text-red-700 text-sm font-bold">
                   Cancel
                </button>
             </div>
          </div>

          {/* Existing Interventions Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden w-full max-w-3xl">
             <div className="p-3 border-b border-gray-200 flex gap-2">
                <button className="text-gray-400 border border-gray-200 px-3 py-1 rounded bg-gray-50 hover:bg-gray-100 font-bold">+</button>
                <button className="text-gray-400 border border-gray-200 px-3 py-1 rounded bg-gray-50 hover:bg-gray-100 font-bold">-</button>
             </div>
             <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-700">
                   <tr>
                      <th className="p-3 font-bold border-r border-gray-100">Run 1 Defect</th>
                      <th className="p-3 font-bold border-r border-gray-100">Run 2 Defect</th>
                      <th className="p-3 font-bold">Action</th>
                   </tr>
                </thead>
                <tbody>
                   <tr>
                      <td colSpan={3} className="p-6 text-center text-gray-400 italic">
                         <div className="flex justify-center items-center gap-2">
                            <FiInfo /> No data found. Change your filter or search term or why not add something...
                         </div>
                      </td>
                   </tr>
                </tbody>
             </table>
          </div>
        </div>
      )}

    </div>
  );
}

const FiInfo = () => (
  <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
);
