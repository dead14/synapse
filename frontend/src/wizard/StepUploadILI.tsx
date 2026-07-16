import { useState, useEffect } from 'react';
import { FiUploadCloud, FiInfo, FiChevronDown, FiChevronUp, FiDatabase, FiSettings, FiShield, FiPlus } from 'react-icons/fi';
import Papa from 'papaparse';
import { apiUrl } from '../utils/api';
import { summarizeIliRows } from '../utils/iliRowParser';
import { readXlsxRows } from '../utils/xlsx';

interface StepUploadILIProps {
  onNext: (data?: any) => void;
}

async function readUploadedRows(file: File): Promise<Record<string, unknown>[]> {
  if (file.name.toLowerCase().endsWith('.csv')) {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: 'greedy',
        complete: (result) => resolve(result.data),
        error: reject,
      });
    });
  }

  return readXlsxRows(file);
}

export default function StepUploadILI({ onNext }: StepUploadILIProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('all');
  const [datasets, setDatasets] = useState<any[]>([{ id: 1, year: '', vendor: '', file: null }, { id: 2, year: '', vendor: '', file: null }]);
  const [masterIndex, setMasterIndex] = useState(1);
  const [algorithm, setAlgorithm] = useState('dtw_hungarian_onedirection');
  const [enablePartialRun, setEnablePartialRun] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionName, setSessionName] = useState('');

  useEffect(() => {
    if (algorithm === 'phylogenetic') {
      setDatasets([
        { id: 1, year: '2020', vendor: 'Rosen', file: null, phyloLabel: 'Ancestor Data' },
        { id: 2, year: '2023', vendor: 'Baker Hughes', file: null, phyloLabel: 'ILI Alignment 1' },
        { id: 3, year: '2026', vendor: 'NDT Global', file: null, phyloLabel: 'ILI Alignment 2' }
      ]);
      setMasterIndex(0);
    } else {
      setMasterIndex(1);
      setDatasets((currentDatasets) => (
        currentDatasets.length === 3 && currentDatasets[0].phyloLabel
          ? [
              { id: 1, year: '2020', vendor: 'Rosen', file: null },
              { id: 2, year: '2023', vendor: 'Baker Hughes', file: null }
            ]
          : currentDatasets
      ));
    }
  }, [algorithm]);

  const allFilesUploaded = datasets.every(ds => ds.file !== null);

  const handleInitialize = async () => {
    setIsProcessing(true);
    try {
      const summaryData: any = {
        sessionName: sessionName || 'Untitled Alignment Session',
        algorithm: algorithm,
        enablePartialRun: enablePartialRun
      };
      const parsedRuns: any[] = [];

      if (algorithm === 'phylogenetic') {
        summaryData.ancestorRun = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
        summaryData.run1 = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
        summaryData.run2 = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
      } else {
        summaryData.newRun = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
        summaryData.oldRun = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
      }

      for (let i = 0; i < datasets.length; i++) {
        const ds = datasets[i];
        if (!ds.file) continue;
        
        let runKey = '';
        if (algorithm === 'phylogenetic') {
          if (i === 0) runKey = 'ancestorRun';
          else if (i === 1) runKey = 'run1';
          else if (i === 2) runKey = 'run2';
        } else {
          // Non-phylogenetic runs are assigned after every file is parsed so
          // additional historical uploads cannot overwrite each other.
          runKey = '';
        }
        
        const jsonData = await readUploadedRows(ds.file);
        
        const { rawFeatures, counts } = summarizeIliRows(jsonData);

        const parsedRun = {
          name: ds.file.name,
          vendor: ds.vendor || '',
          year: ds.year || '',
          tool: ds.tool || '',
          rawFeatures: rawFeatures,
          ...counts
        };
        if (algorithm === 'phylogenetic') {
          summaryData[runKey] = parsedRun;
        } else {
          parsedRuns[i] = parsedRun;
        }
      }

      if (algorithm !== 'phylogenetic') {
        const masterRun = parsedRuns[masterIndex];
        const historicalRuns = parsedRuns
          .filter((run, index) => run && index !== masterIndex)
          .sort((left, right) => Number(right.year || 0) - Number(left.year || 0));
        summaryData.masterRun = masterRun;
        summaryData.historicalRuns = historicalRuns;
        // Backward-compatible pair consumed by the current DTW/Hungarian
        // engines. NEW is always the newest/master run.
        summaryData.newRun = masterRun;
        summaryData.oldRun = historicalRuns[0];
      }
      
      onNext({ summaryData, algorithm, enablePartialRun });
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error && err.message ? `\n\nDetail: ${err.message}` : '';
      alert(`Gagal membaca file Excel. Pastikan formatnya .xlsx/.csv dan header berada di baris pertama.${detail}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleSection = (section: string) => {
    if (expandedSection === 'all') {
      setExpandedSection(section);
    } else {
      setExpandedSection(expandedSection === section ? null : section);
    }
  };

  const isExpanded = (section: string) => expandedSection === 'all' || expandedSection === section;

  return (
    <div className="alignment-surface alignment-intake w-full flex flex-col gap-4 animate-fade-in">
      
      {/* Page Title */}
      <section className="alignment-intake__header">
        <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><FiDatabase size={14} /></span>
              01 — New alignment run
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Inspection intake</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-base">Add the inspection runs that will be compared, then provide the pipeline context for a traceable alignment.</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <a 
            href={apiUrl('/api/download-template')}
            target="_blank"
            rel="noreferrer"
            className="alignment-intake__action alignment-intake__action--secondary"
          >
            Download Excel Template
          </a>
          <button 
            onClick={handleInitialize}
            disabled={!allFilesUploaded || isProcessing}
            className={`alignment-intake__action alignment-intake__action--primary group ${allFilesUploaded && !isProcessing ? '' : 'is-disabled'}`}
          >
            {isProcessing ? 'Reading Data...' : 'Initialize Alignment'}
            {allFilesUploaded && !isProcessing && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 transition-transform group-hover:translate-x-1">
                →
              </span>
            )}
          </button>
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-4">
        {/* Left Column (Now Bottom): Asset & Specs */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          
          {/* Section 1: Asset Identification */}
          <div className="alignment-config-panel">
            <button 
              onClick={() => toggleSection('asset')}
              className="alignment-config-panel__trigger"
            >
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FiInfo className="text-gray-500" /> Asset & Operations
              </h3>
              {isExpanded('asset') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('asset') && (
              <div className="alignment-config-panel__body grid grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pipeline Name (Session Name)</label>
                  <input type="text" value={sessionName} onChange={(e) => setSessionName(e.target.value)} className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-all"   placeholder="e.g. SMR-SBY Gas Line" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Segment Route</label>
                  <input type="text" className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-all"   placeholder="e.g. Station A - Station B" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
                  <select className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white transition-all"  >
                    <option>Onshore</option>
                    <option>Offshore</option>
                    <option>Subsea</option>
                    <option>Swamp</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Length (km)</label>
                  <input type="number" className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-all"   placeholder="150" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Medium</label>
                  <select className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white transition-all"  >
                    <option>Natural Gas (Dry)</option>
                    <option>Natural Gas (Wet)</option>
                    <option>Crude Oil</option>
                    <option>Refined Product</option>
                    <option>Water</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">MAOP (psi)</label>
                  <input type="number" className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-all"   placeholder="e.g. 1200" />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Physical Specs & Protection */}
          <div className="alignment-config-panel">
            <button 
              onClick={() => toggleSection('specs')}
              className="alignment-config-panel__trigger"
            >
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FiSettings className="text-gray-500" /> Physical Specs & Protection
              </h3>
              {isExpanded('specs') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('specs') && (
              <div className="alignment-config-panel__body grid grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Outer Diameter (OD)</label>
                  <select className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white transition-all"  >
                    <option>10 inch</option>
                    <option>12 inch</option>
                    <option>24 inch</option>
                    <option>36 inch</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nominal WT (mm)</label>
                  <input type="number" step="0.01" className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-all"   placeholder="e.g. 12.7" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Material Grade</label>
                  <select className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white transition-all"  >
                    <option>API 5L X42</option>
                    <option>API 5L X52</option>
                    <option>API 5L X60</option>
                    <option>API 5L X65</option>
                    <option>API 5L X70</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Seam Type</label>
                  <select className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white transition-all"  >
                    <option>SMLS (Seamless)</option>
                    <option>ERW</option>
                    <option>DSAW</option>
                    <option>SAWH</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">External Coating</label>
                  <select className="w-full rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white transition-all"  >
                    <option>3LPE</option>
                    <option>FBE</option>
                    <option>Coal Tar Enamel (CTE)</option>
                    <option>Bare</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Inst. Year / Loc Class</label>
                  <div className="flex gap-2">
                    <input type="text" className="w-1/2 rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 outline-none transition-all"   placeholder="Year" />
                    <select className="w-1/2 rounded-full border border-gray-300 px-5 py-2.5 text-sm focus:border-brand-500 outline-none bg-white transition-all"  >
                      <option>Class 1</option>
                      <option>Class 2</option>
                      <option>Class 3</option>
                      <option>Class 4</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right Column: ILI Uploads */}
        <div className="flex flex-col gap-4">
          <div className="alignment-run-panel">
            <div className="alignment-run-panel__toolbar">
              <div className="flex items-center gap-4">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Run pair setup</p>
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <FiShield className="text-brand-600" /> ILI data configuration
                  </h3>
                </div>
                {algorithm !== 'phylogenetic' && datasets.length < 5 && (
                  <button 
                    onClick={() => setDatasets([...datasets, { id: Date.now(), year: '', vendor: 'Rosen', file: null }])}
                    className="alignment-add-run"
                  >
                    <FiPlus size={14} /> Add another ILI data
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Strategy</label>
                <select 
                  className="alignment-strategy-select"
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value)}
                >
                  <option value="dtw_hungarian_onedirection">DTW + Ordered Match (OneDirection)</option>
                  <option value="dtw_hungarian">DTW + Hungarian Match (Legacy)</option>
                  <option value="traditional_hungarian">Traditional Hungarian</option>
                  <option value="manual">Manual Algorithm</option>
                  <option value="phylogenetic">Phylogenetic Algorithm</option>
                </select>
              </div>
              {algorithm !== 'phylogenetic' && (
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" 
                      checked={enablePartialRun}
                      onChange={(e) => setEnablePartialRun(e.target.checked)}
                    />
                    Enable Partial Run (Tie-In)
                  </label>
                </div>
              )}
            </div>
            
             <div className="alignment-dataset-grid no-scrollbar">
              
              {datasets.map((ds, index) => {
                const isMaster = index === masterIndex;
                return (
                  <div key={ds.id} className={`alignment-dataset-card${isMaster ? ' is-master' : ''}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className={`h-9 w-1 rounded-full ${isMaster ? 'bg-brand-500' : 'bg-slate-300'}`}></div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{isMaster ? 'Alignment anchor' : 'Comparison source'}</p>
                          <h4 className={`font-bold ${isMaster ? 'text-brand-800' : 'text-slate-800'}`}>
                            {algorithm === 'phylogenetic' ? ds.phyloLabel : isMaster ? 'Master dataset' : `Dataset ${index + 1}`}
                          </h4>
                        </div>
                      </div>
                    </div>

                    <div className="alignment-dropzone group">
                      <input 
                        type="file" 
                        accept=".csv,.xlsx" 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            const newDs = [...datasets];
                            const file = e.target.files[0];
                            newDs[index].file = file;
                            
                            // Auto-extract year from filename if it matches YYYY
                            const yearMatch = file.name.match(/\b(19|20)\d{2}\b/);
                            if (yearMatch) {
                              newDs[index].year = yearMatch[0];
                            }
                            
                            setDatasets(newDs);
                          }
                        }}
                      />
                      {ds.file ? (
                        <>
                          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mb-2">
                            <FiDatabase className="text-green-600 text-xl" />
                          </div>
                          <p className="text-sm font-bold text-gray-800 text-center px-4 truncate w-full">{ds.file.name}</p>
                          <p className="text-xs text-gray-500 mt-1">Click to replace</p>
                        </>
                      ) : (
                        <>
                          <FiUploadCloud className={`text-3xl mb-2 ${isMaster ? 'text-brand-400 group-hover:text-brand-500' : 'text-gray-400 group-hover:text-brand-500'}`} />
                          <p className="text-sm font-medium text-gray-700">Upload Data File</p>
                          <p className="text-xs text-gray-500 mt-1">Drag & drop or click to browse</p>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
