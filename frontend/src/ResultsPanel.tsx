import React, { useState, useMemo } from 'react';
import { FiSearch, FiFileText, FiSave, FiEdit, FiInfo, FiMaximize, FiMinimize } from 'react-icons/fi';
import { Scatter } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, Title } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, Title);

interface ResultsPanelProps {
  data: any[];
  loading: boolean;
}

export default function ResultsPanel({ data, loading }: ResultsPanelProps) {
  const [activeTab, setActiveTab] = useState('Results');
  const [radioFilter, setRadioFilter] = useState('All');
  const [unmatchedOld, setUnmatchedOld] = useState(false);
  const [unmatchedNew, setUnmatchedNew] = useState(false);
  
  // Interventions state
  const [interventions, setInterventions] = useState<any[]>([]);
  const [run1Defect, setRun1Defect] = useState('');
  const [run2Defect, setRun2Defect] = useState('');
  const [interventionAction, setInterventionAction] = useState('-');
  const [showInterventionForm, setShowInterventionForm] = useState(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [distanceStart, setDistanceStart] = useState('');
  const [distanceEnd, setDistanceEnd] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const tabs = ['Results', 'ILI Run 1', 'ILI Run 2', 'Interventions'];
  
  // 1. Process data with interventions
  const processedData = useMemo(() => {
    let baseData = (data && data.length > 1) ? data.slice(1) : [];
    
    // Apply interventions
    interventions.forEach(inv => {
      if (inv.action === 'Unmatched') {
        const idx = baseData.findIndex((row: any) => row['Unnamed: 29'] === inv.run1 && row['Unnamed: 2'] === inv.run2);
        if (idx !== -1) {
          const row = baseData[idx];
          // Split into two unmatched
          const oldUnmatched = { ...row, 'Unnamed: 2': '', '<  DATA BARU 2025 (Vendor Baru)': null, 'Unnamed: 10': '', 'Unnamed: 8': '', 'Unnamed: 5': '', 'Unnamed: 6': '', 'Unnamed: 7': '' };
          const newUnmatched = { ...row, 'Unnamed: 29': '', 'DATA LAMA 2020 (Vendor Lama)  >': null, 'Unnamed: 37': '', 'Unnamed: 35': '', 'Unnamed: 32': '', 'Unnamed: 33': '', 'Unnamed: 34': '' };
          baseData = [...baseData.slice(0, idx), oldUnmatched, newUnmatched, ...baseData.slice(idx + 1)];
        }
      } else if (inv.action === 'Matched') {
        const oldIdx = baseData.findIndex((row: any) => row['Unnamed: 29'] === inv.run1 && (!row['Unnamed: 2'] || row['Unnamed: 2'] === ''));
        const newIdx = baseData.findIndex((row: any) => row['Unnamed: 2'] === inv.run2 && (!row['Unnamed: 29'] || row['Unnamed: 29'] === ''));
        
        if (oldIdx !== -1 && newIdx !== -1) {
          const oldRow = baseData[oldIdx];
          const newRow = baseData[newIdx];
          // Merge
          const mergedRow = {
            ...oldRow,
            'Unnamed: 2': newRow['Unnamed: 2'],
            '<  DATA BARU 2025 (Vendor Baru)': newRow['<  DATA BARU 2025 (Vendor Baru)'],
            'Unnamed: 10': newRow['Unnamed: 10'],
            'Unnamed: 8': newRow['Unnamed: 8'],
            'Unnamed: 5': newRow['Unnamed: 5'],
            'Unnamed: 6': newRow['Unnamed: 6'],
            'Unnamed: 7': newRow['Unnamed: 7']
          };
          baseData = baseData.filter((_, i) => i !== oldIdx && i !== newIdx);
          baseData.push(mergedRow);
        }
      }
    });
    
    return baseData;
  }, [data, interventions]);

  // 2. Filter data
  const filteredData = useMemo(() => {
    return processedData.filter((row: any) => {
      const run1 = row['Unnamed: 29'];
      const run2 = row['Unnamed: 2'];
      const dist1 = row['DATA LAMA 2020 (Vendor Lama)  >'];
      const dist2 = row['<  DATA BARU 2025 (Vendor Baru)'];
      
      const hasRun1 = run1 !== null && run1 !== undefined && run1 !== '' && run1 !== '-';
      const hasRun2 = run2 !== null && run2 !== undefined && run2 !== '' && run2 !== '-';
      
      const isMatched = hasRun1 && hasRun2;
      const isUnmatchedOld = hasRun1 && !hasRun2;
      const isUnmatchedNew = !hasRun1 && hasRun2;
      
      // Match type filter
      let typeInclude = false;
      if (!unmatchedOld && !unmatchedNew) typeInclude = isMatched;
      else if (unmatchedOld && !unmatchedNew) typeInclude = isMatched || isUnmatchedOld;
      else if (!unmatchedOld && unmatchedNew) typeInclude = isMatched || isUnmatchedNew;
      else typeInclude = true; // both checked
      
      if (!typeInclude) return false;
      
      // Distance filter
      if (radioFilter === 'Distance') {
        const start = parseFloat(distanceStart);
        const end = parseFloat(distanceEnd);
        if (!isNaN(start) && !isNaN(end)) {
          const d1In = typeof dist1 === 'number' && dist1 >= start && dist1 <= end;
          const d2In = typeof dist2 === 'number' && dist2 >= start && dist2 <= end;
          if (!d1In && !d2In) return false;
        }
      }
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!(run1?.toString().toLowerCase().includes(query) || run2?.toString().toLowerCase().includes(query))) {
          return false;
        }
      }
      
      return true;
    });
  }, [processedData, radioFilter, unmatchedOld, unmatchedNew, distanceStart, distanceEnd, searchQuery]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const currentData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const saveIntervention = () => {
    if (!run1Defect && !run2Defect) return;
    if (interventionAction === '-') return;
    setInterventions([...interventions, { id: Date.now().toString(), run1: run1Defect, run2: run2Defect, action: interventionAction }]);
    setRun1Defect('');
    setRun2Defect('');
    setInterventionAction('-');
    setShowInterventionForm(false);
  };

  const removeIntervention = (id: string) => {
    setInterventions(interventions.filter(i => i.id !== id));
  };

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
        <span className="text-gray-500">Total: {filteredData.length} items</span>
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
    <div className={isFullScreen ? "fixed inset-0 z-[9999] bg-white flex flex-col overflow-hidden" : "bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden"}>
      
      {/* Tabs Header */}
      <div className="flex justify-between border-b border-gray-200 bg-gray-50/50 pr-4">
        <div className="flex">
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
        <button 
          onClick={() => setIsFullScreen(!isFullScreen)}
          className="text-orange-500 hover:text-orange-700 self-center p-2 rounded-full hover:bg-orange-100 transition-colors flex items-center gap-2 font-medium"
          title={isFullScreen ? "Exit Full Screen" : "Full Screen Data"}
        >
          {isFullScreen ? <FiMinimize size={20} /> : <FiMaximize size={20} />}
        </button>
      </div>

      {(activeTab === 'Results' || activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2') && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Filters Area */}
          <div className="p-4 bg-[#fffdf0] border-b border-gray-200 text-sm flex flex-col gap-3">
            <div className="flex gap-6 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="filter" checked={radioFilter === 'All'} onChange={() => {setRadioFilter('All'); setCurrentPage(1);}} className="text-blue-500" />
                All
              </label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="filter" checked={radioFilter === 'Distance'} onChange={() => {setRadioFilter('Distance'); setCurrentPage(1);}} className="text-blue-500" />
                  Distance
                </label>
                {radioFilter === 'Distance' && (
                  <div className="flex items-center gap-2 ml-2">
                    <span className="text-gray-600">Start:</span>
                    <input type="text" value={distanceStart} onChange={e => setDistanceStart(e.target.value)} className="border border-gray-300 rounded px-2 py-0.5 w-20 focus:border-blue-400 focus:outline-none" />
                    <span className="text-gray-600 ml-2">End:</span>
                    <input type="text" value={distanceEnd} onChange={e => setDistanceEnd(e.target.value)} className="border border-gray-300 rounded px-2 py-0.5 w-20 focus:border-blue-400 focus:outline-none" />
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="filter" checked={radioFilter === 'Chart'} onChange={() => {setRadioFilter('Chart'); setCurrentPage(1);}} className="text-blue-500" />
                Chart
              </label>
            </div>
            <div className="flex gap-6 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={unmatchedOld} onChange={(e) => {setUnmatchedOld(e.target.checked); setCurrentPage(1);}} className="rounded text-blue-500" />
                Unmatched old
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={unmatchedNew} onChange={(e) => {setUnmatchedNew(e.target.checked); setCurrentPage(1);}} className="rounded text-blue-500" />
                Unmatched new
              </label>
            </div>
          </div>

          {/* Search Bar */}
          <div className="p-2 border-b border-gray-200 bg-white flex justify-between items-center">
            <div className="flex items-center text-blue-600 pl-2">
              <FiFileText size={18} />
            </div>
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={e => {setSearchQuery(e.target.value); setCurrentPage(1);}}
                placeholder="Search" 
                className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Chart View */}
          {radioFilter === 'Chart' ? (
             <div className="flex-1 p-8 overflow-auto bg-gray-50 flex items-center justify-center">
                <div className="w-full max-w-4xl bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-bold text-gray-800 mb-6">Filtered Depth Correlation</h3>
                  <div className="h-[400px]">
                    <Scatter 
                      options={{
                        maintainAspectRatio: false,
                        scales: {
                          x: { title: { display: true, text: 'Depth Run 1 (mm)' } },
                          y: { title: { display: true, text: 'Depth Run 2 (mm)' } }
                        }
                      }}
                      data={{
                        datasets: [{
                          label: 'Depth Correlation',
                          data: filteredData.map((r: any) => ({
                            x: parseFloat(r['Unnamed: 37']) || 0,
                            y: parseFloat(r['Unnamed: 10']) || 0
                          })).filter((p: any) => p.x > 0 && p.y > 0),
                          backgroundColor: '#3b82f6'
                        }]
                      }} 
                    />
                  </div>
                </div>
             </div>
          ) : (
            <div className="flex-1 overflow-auto">
              {activeTab === 'Results' && (
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
                        const run1Defect = row['Unnamed: 29'];
                        const absDist1 = row['DATA LAMA 2020 (Vendor Lama)  >'];
                        const depth1 = row['Unnamed: 37'];
                        const run2Defect = row['Unnamed: 2'];
                        const absDist2 = row['<  DATA BARU 2025 (Vendor Baru)'];
                        const depth2 = row['Unnamed: 10'];
                        const len1 = row['Unnamed: 35'];
                        const len2 = row['Unnamed: 8'];
                        
                        const hasR1 = run1Defect && run1Defect !== '-';
                        const hasR2 = run2Defect && run2Defect !== '-';
                        
                        const dist1Formatted = hasR1 && typeof absDist1 === 'number' ? absDist1.toFixed(3) : '';
                        const dist2Formatted = hasR2 && typeof absDist2 === 'number' ? absDist2.toFixed(3) : '';
                        const distAdj = hasR1 && typeof absDist1 === 'number' ? (absDist1 - 0.1).toFixed(3) : '';
                        
                        const d1 = hasR1 ? parseFloat(depth1) : 0;
                        const d2 = hasR2 ? parseFloat(depth2) : 0;
                        const cr = (!isNaN(d1) && !isNaN(d2)) ? ((d2 - d1) / 5).toFixed(2) : '0';
                        
                        const l1 = hasR1 ? parseFloat(len1) : 0;
                        const l2 = hasR2 ? parseFloat(len2) : 0;
                        const latGrowth = (!isNaN(l1) && !isNaN(l2)) ? ((l2 - l1) / 5).toFixed(2) : '0';

                        return (
                          <tr key={i} className="hover:bg-blue-50/50 transition-colors cursor-pointer">
                            <td className="p-3 border-r border-gray-100">{hasR1 ? run1Defect : ''}</td>
                            <td className="p-3 border-r border-gray-100">{dist1Formatted}</td>
                            <td className="p-3 border-r border-gray-100">{hasR1 ? depth1 : ''}</td>
                            <td className="p-3 border-r border-gray-100 bg-gray-50">{distAdj}</td>
                            <td className="p-3 border-r border-gray-100">{hasR2 ? run2Defect : ''}</td>
                            <td className="p-3 border-r border-gray-100">{dist2Formatted}</td>
                            <td className="p-3 border-r border-gray-100 font-medium">{hasR2 ? depth2 : ''}</td>
                            <td className="p-3 border-r border-gray-100 text-blue-600 font-bold">{cr}</td>
                            <td className="p-3 text-blue-600 font-bold">{latGrowth}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}

              {(activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2') && (
                <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-700 sticky top-0 border-b border-gray-200 shadow-sm z-10">
                      <tr>
                        <th className="p-3 font-bold border-r border-gray-200">Defect ID</th>
                        <th className="p-3 font-bold border-r border-gray-200">Distance <span className="text-blue-500">m</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Distance Adjusted <span className="text-blue-500">m</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Relative to U/S Weld <span className="text-blue-500">m</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Relative to Nearest Weld <span className="text-blue-500">m</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Wall Thickness <span className="text-blue-500">mm</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Orientation <span className="text-blue-500">deg</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Length <span className="text-blue-500">mm</span></th>
                        <th className="p-3 font-bold border-r border-gray-200\">Width <span className="text-blue-500">mm</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Depth <span className="text-blue-500">mm</span></th>
                        <th className="p-3 font-bold border-r border-gray-200">Flaw Depth <span className="text-blue-500">[%]</span></th>
                        <th className="p-3 font-bold">Wall Side</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                      {loading ? (
                        <tr><td colSpan={12} className="p-8 text-center text-gray-400">Loading data...</td></tr>
                      ) : (
                        currentData.map((row: any, i: number) => {
                          const isOld = activeTab === 'ILI Run 1';
                          
                          const defectId = row[isOld ? 'Unnamed: 29' : 'Unnamed: 2'];
                          if (!defectId || defectId === '-') return null;
                          
                          const distance = row[isOld ? 'DATA LAMA 2020 (Vendor Lama)  >' : '<  DATA BARU 2025 (Vendor Baru)'];
                          const distGw = row[isOld ? 'Unnamed: 32' : 'Unnamed: 5'];
                          const wt = row[isOld ? 'Unnamed: 33' : 'Unnamed: 6'];
                          const oclock = row[isOld ? 'Unnamed: 34' : 'Unnamed: 7'];
                          const length = row[isOld ? 'Unnamed: 35' : 'Unnamed: 8'];
                          const width = row[isOld ? 'Unnamed: 36' : 'Unnamed: 9'];
                          const depth = row[isOld ? 'Unnamed: 37' : 'Unnamed: 10'];
                          const surface = row[isOld ? 'Unnamed: 38' : 'Unnamed: 11'] ?? 'Internal';
                          
                          const distFormatted = typeof distance === 'number' ? distance.toFixed(3) : '';
                          const distAdj = typeof distance === 'number' ? (distance - 0.1).toFixed(3) : '';
                          const nearWeld = distGw ? (parseFloat(distGw) - 0.05).toFixed(2) : '';
                          const perc = (parseFloat(depth) / parseFloat(wt) * 100).toFixed(1);

                          return (
                            <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                              <td className="p-3 border-r border-gray-100">{defectId}</td>
                              <td className="p-3 border-r border-gray-100">{distFormatted}</td>
                              <td className="p-3 border-r border-gray-100 bg-gray-50">{distAdj}</td>
                              <td className="p-3 border-r border-gray-100">{distGw}</td>
                              <td className="p-3 border-r border-gray-100">{nearWeld}</td>
                              <td className="p-3 border-r border-gray-100">{wt}</td>
                              <td className="p-3 border-r border-gray-100">{oclock}</td>
                              <td className="p-3 border-r border-gray-100">{length}</td>
                              <td className="p-3 border-r border-gray-100">{width}</td>
                              <td className="p-3 border-r border-gray-100">{depth}</td>
                              <td className="p-3 border-r border-gray-100">{isNaN(Number(perc)) ? '-' : perc}</td>
                              <td className="p-3 text-blue-600 font-medium">{surface}</td>
                            </tr>
                          );
                        })
                      )}
                  </tbody>
                </table>
              )}
            </div>
          )}
          
          {radioFilter !== 'Chart' && <PaginationFooter />}
        </div>
      )}

      {activeTab === 'Interventions' && (
        <div className="flex-1 bg-white flex flex-col">
          <div className="p-3 border-b border-gray-200 bg-gray-50 flex gap-2">
            <button onClick={() => setShowInterventionForm(!showInterventionForm)} className="text-gray-600 border border-gray-300 px-3 py-1 rounded bg-white hover:bg-gray-50 shadow-sm font-bold flex items-center justify-center min-w-[32px]">
              +
            </button>
            <button className="text-gray-600 border border-gray-300 px-3 py-1 rounded bg-white hover:bg-gray-50 shadow-sm font-bold flex items-center justify-center min-w-[32px]">
              -
            </button>
            <button className="text-blue-600 border border-gray-300 px-3 py-1 rounded bg-white hover:bg-gray-50 shadow-sm font-bold flex items-center justify-center">
              <FiFileText className="mr-1"/> Export
            </button>
            <div className="ml-auto relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search" className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          {showInterventionForm && (
            <div className="p-4 border-b border-gray-200 bg-[#f8f9fa] animate-fade-in">
              <div className="max-w-3xl bg-white border border-gray-200 p-4 rounded shadow-sm">
                <h4 className="font-bold mb-4 text-gray-700">New Intervention</h4>
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Run 1 Defect</label>
                    <input type="text" value={run1Defect} onChange={e => setRun1Defect(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Run 2 Defect</label>
                    <input type="text" value={run2Defect} onChange={e => setRun2Defect(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Action</label>
                    <select value={interventionAction} onChange={e => setInterventionAction(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-1.5 focus:border-blue-500 focus:outline-none">
                      <option value="-">-</option>
                      <option value="Matched">Matched</option>
                      <option value="Unmatched">Unmatched</option>
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex gap-3">
                  <button onClick={saveIntervention} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-bold flex items-center shadow-sm">
                    <FiSave className="mr-2" /> Save
                  </button>
                  <button onClick={() => setShowInterventionForm(false)} className="text-gray-500 hover:text-gray-700 px-4 py-1.5 text-sm font-bold">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 sticky top-0">
                  <tr>
                    <th className="p-3 w-12 text-center border-r border-gray-200"></th>
                    <th className="p-3 font-bold border-r border-gray-200">Run 1 Defect</th>
                    <th className="p-3 font-bold border-r border-gray-200">Run 2 Defect</th>
                    <th className="p-3 font-bold">Action</th>
                  </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {interventions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-gray-400 italic">
                      <div className="flex justify-center items-center gap-2">
                        <FiInfo /> No interventions added yet. Click + to add one.
                      </div>
                    </td>
                  </tr>
                ) : (
                  interventions.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="p-3 text-center border-r border-gray-100">
                        <button className="text-blue-500 hover:text-blue-700"><FiEdit /></button>
                      </td>
                      <td className="p-3 border-r border-gray-100">{inv.run1}</td>
                      <td className="p-3 border-r border-gray-100">{inv.run2}</td>
                      <td className="p-3">{inv.action}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
