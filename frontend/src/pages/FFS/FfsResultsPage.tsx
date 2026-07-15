import { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { FiArrowLeft, FiSearch, FiFilter } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import type { FfsResult, FfsConfig } from '../../lib/ffs/types';

export default function FfsResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const state = location.state as { results: FfsResult[], config: FfsConfig } | null;
  
  const results = state?.results ?? [];
  const config = state?.config;
  const thresh = config?.highlightYears ?? 0;

  const [search, setSearch] = useState('');
  const [filterAccept, setFilterAccept] = useState('All');
  const [sortCol, setSortCol] = useState<keyof FfsResult>('ld');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 100;

  // Derive summary stats
  const okCount = results.filter(r => r.acceptance === 'Acceptable').length;
  const failCount = results.filter(r => r.acceptance === 'Un-Acceptable').length;
  const warnCount = results.filter(r => r.expectedLife < thresh).length;

  // Filtering and Sorting
  const filtered = results.filter(r => {
    if (search) {
      const q = search.toLowerCase();
      if (!String(r.ld).toLowerCase().includes(q) && !String(r.section).toLowerCase().includes(q)) {
        return false;
      }
    }
    if (filterAccept !== 'All' && r.acceptance !== filterAccept) return false;
    return true;
  }).sort((a, b) => {
    const av = a[sortCol];
    const bv = b[sortCol];
    const dir = sortDir === 'asc' ? 1 : -1;
    
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const startIdx = (page - 1) * pageSize;
  const paginated = filtered.slice(startIdx, startIdx + pageSize);

  const handleSort = (col: keyof FfsResult) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  if (!state || !config) {
    return <Navigate to="/ffs" replace />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageMeta title="FFS Results" description="Assessment Results" />
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white uppercase">Assessment Results</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Line: {config.lineName} · Method: {config.method === 'modified' ? 'Modified B31G' : 'Original B31G'} · ILI: {config.iliDate.toLocaleDateString()}
          </p>
        </div>
        <button 
          onClick={() => navigate('/ffs')}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          <FiArrowLeft /> New Assessment
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Total Defects</div>
          <div className="text-3xl font-bold text-slate-800 dark:text-white leading-none">{results.length}</div>
          <div className="text-xs text-slate-500 mt-2">ILI defect records</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Acceptable</div>
          <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-500 leading-none">{okCount}</div>
          <div className="text-xs text-slate-500 mt-2">ERF &lt; 1 &amp; Depth &lt; 80%</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Un-Acceptable</div>
          <div className="text-3xl font-bold text-red-600 dark:text-red-500 leading-none">{failCount}</div>
          <div className="text-xs text-slate-500 mt-2">Immediate attention</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Below Threshold</div>
          <div className="text-3xl font-bold text-amber-500 dark:text-amber-500 leading-none">{warnCount}</div>
          <div className="text-xs text-slate-500 mt-2">Expected life &lt; {thresh} yrs</div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden flex flex-col">
        {/* Controls */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap gap-4 items-center bg-slate-50/50 dark:bg-slate-900/50">
          <div className="relative flex-1 min-w-[200px]">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search LD or Section..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <FiFilter className="text-slate-400" />
            <select 
              value={filterAccept}
              onChange={e => { setFilterAccept(e.target.value); setPage(1); }}
              className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="All">All Status</option>
              <option value="Acceptable">Acceptable</option>
              <option value="Un-Acceptable">Un-Acceptable</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 uppercase text-[11px] font-bold tracking-wider">
              <tr>
                <th className="px-4 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300" onClick={() => handleSort('ld')}>LD [m] {sortCol==='ld'&&(sortDir==='asc'?'▲':'▼')}</th>
                <th className="px-4 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300" onClick={() => handleSort('section')}>Section {sortCol==='section'&&(sortDir==='asc'?'▲':'▼')}</th>
                <th className="px-4 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300" onClick={() => handleSort('maxDepthPct')}>Depth % {sortCol==='maxDepthPct'&&(sortDir==='asc'?'▲':'▼')}</th>
                <th className="px-4 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300" onClick={() => handleSort('ERF')}>ERF {sortCol==='ERF'&&(sortDir==='asc'?'▲':'▼')}</th>
                <th className="px-4 py-3">P_safe [MPa]</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300" onClick={() => handleSort('expectedLife')}>Exp. Life {sortCol==='expectedLife'&&(sortDir==='asc'?'▲':'▼')}</th>
                <th className="px-4 py-3">Fail Year</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginated.length > 0 ? (
                paginated.map((r, i) => {
                  const isOk = r.acceptance === 'Acceptable';
                  const isWarn = r.expectedLife < thresh;
                  return (
                    <tr 
                      key={i} 
                      className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors ${isWarn ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
                    >
                      <td className={`px-4 py-3 font-medium border-l-4 ${isOk ? 'border-l-emerald-500' : 'border-l-red-500'}`}>{r.ld}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.section}</td>
                      <td className={`px-4 py-3 ${r.maxDepthPct >= 80 ? 'text-red-600 font-semibold' : ''}`}>{r.maxDepthPct.toFixed(2)}</td>
                      <td className={`px-4 py-3 font-medium ${r.ERF >= 1 ? 'text-red-600' : r.ERF > 0.8 ? 'text-amber-500' : 'text-emerald-600'}`}>{r.ERF.toFixed(3)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.safePressure.toFixed(3)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${isOk ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                          {r.acceptance}
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-medium ${r.expectedLife < thresh ? 'text-amber-500' : ''}`}>
                        {r.expectedLife >= 200 ? '≥200' : r.expectedLife.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.yearService}</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 italic">No defects found matching criteria.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Showing {startIdx + 1}-{Math.min(startIdx + pageSize, filtered.length)} of {filtered.length} records
          </span>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-50"
            >
              Prev
            </button>
            <span className="px-3 py-1 text-sm text-slate-600 dark:text-slate-400">{page} / {totalPages}</span>
            <button 
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
