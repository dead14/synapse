import { useState, useEffect } from 'react';
import { FiUploadCloud, FiInfo, FiChevronDown, FiChevronUp, FiDatabase, FiSettings, FiShield, FiStar, FiPlus } from 'react-icons/fi';
import Papa from 'papaparse';
import { apiUrl } from '../utils/api';
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
  const [algorithm, setAlgorithm] = useState('dtw_hungarian');
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
          runKey = i === masterIndex ? 'oldRun' : 'newRun';
        }
        
        const jsonData = await readUploadedRows(ds.file);
        
        const counts = { total: jsonData.length, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
        const rawFeatures: any[] = [];
        
        jsonData.forEach((row: any, idx: number) => {
          const keys = Object.keys(row);
          // Safely find the type column, avoiding "Feature ID"
          const typeKey = keys.find(k => /feature type|feature_type|^type$/i.test(k)) 
                       || keys.find(k => /type|feature/i.test(k) && !/id/i.test(k));
          let ftype = (typeKey ? row[typeKey] : '').toString().toLowerCase();
          
          let standardizedType = 'other';
          if (ftype.includes('metal loss') || ftype.includes('corrosion') || ftype.includes('ml')) { counts.anomalies++; standardizedType = 'anomaly'; }
          else if (ftype.includes('weld') || ftype === 'gw' || ftype.includes('girth') || ftype.includes('seam')) { counts.welds++; standardizedType = 'weld'; }
          else if (ftype.includes('valve')) { counts.valves++; standardizedType = 'valve'; }
          else if (ftype.includes('tee')) { counts.tees++; standardizedType = 'tee'; }
          else if (ftype.includes('tap') || ftype.includes('offtake')) { counts.offtakes++; standardizedType = 'offtake'; }
          else if (ftype.includes('bend')) { counts.bends++; standardizedType = 'bend'; }
          else { counts.others++; }
          
          const distKey = keys.find(k => /odometer|log[ _-]?distance|^distance(?:[ _-]?m)?$|^dist(?:ance)?(?:[ _-]?m)?$|chainage/i.test(k));
          let dist = 0;
          if (distKey && row[distKey] !== undefined && row[distKey] !== null) {
            dist = parseFloat(String(row[distKey]).replace(/,/g, ''));
          } else {
            // Fallback: Find the first key that contains a valid number and is not an ID
            const numericKey = keys.find(k => !isNaN(parseFloat(String(row[k]))) && !/id|type|feature|anomaly/i.test(k));
            if (numericKey) {
              dist = parseFloat(String(row[numericKey]).replace(/,/g, ''));
            }
          }
          
          const idKey = keys.find(k => /id|identifier|joint/i.test(k));
          const idVal = idKey ? String(row[idKey] || '').trim() : '';
          const id = idVal !== '' ? idVal : `F-${idx + 1}`;
          
          const depthKey = keys.find(k => /depth|dpt|%wt|wt loss|kedalaman/i.test(k));
          const clockKey = keys.find(k => /clock|orientation|ori|angle|pos|jam|arah/i.test(k));
          const lengthKey = keys.find(k => /length|len|panjang/i.test(k));
          const widthKey = keys.find(k => /width|wid|lebar/i.test(k));
          
          let depth = depthKey && row[depthKey] !== undefined ? parseFloat(String(row[depthKey]).replace(/,/g, '')) : null;
          
          let clockVal = clockKey && row[clockKey] !== undefined ? row[clockKey] : '-';
          let clock = '-';
          if (clockVal !== '-') {
            let clockStr = String(clockVal);
            if (!clockStr.includes(':') && !isNaN(parseFloat(clockStr.replace(/,/g, '.')))) {
              let clockNum = parseFloat(clockStr.replace(/,/g, '.'));
              // Excel stores time as a fraction of a 24-hour day
              if (clockNum >= 0 && clockNum <= 1) {
                let totalHours = clockNum * 24;
                let h = Math.floor(totalHours);
                let m = Math.round((totalHours - h) * 60);
                if (m === 60) { h += 1; m = 0; }
                if (h === 0) h = 12; // Pipe top is usually 12:00
                clock = `${h}:${m.toString().padStart(2, '0')}`;
              } else {
                clock = clockStr;
              }
            } else {
              clock = clockStr;
            }
          }
          
          let length = lengthKey && row[lengthKey] !== undefined ? parseFloat(String(row[lengthKey]).replace(/,/g, '')) : null;
          let width = widthKey && row[widthKey] !== undefined ? parseFloat(String(row[widthKey]).replace(/,/g, '')) : null;
          
          rawFeatures.push({
            ...row,
            id: String(id),
            type: standardizedType,
            dist: isNaN(dist) ? 0 : dist,
            originalType: typeKey ? row[typeKey] : 'Unknown',
            depth: isNaN(depth as number) ? null : depth,
            clock: clock,
            length: isNaN(length as number) ? null : length,
            width: isNaN(width as number) ? null : width
          });
        });

        summaryData[runKey] = {
          name: ds.file.name,
          vendor: ds.vendor || '',
          year: ds.year || '',
          tool: ds.tool || '',
          rawFeatures: rawFeatures,
          ...counts
        };
      }
      
      onNext({ summaryData, enablePartialRun });
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
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      
      {/* Page Title */}
      <div className="bg-white rounded-none p-8 shadow-sm border border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiDatabase className="text-brand-500" /> Inspection Intake Form
          </h2>
          <p className="text-gray-500 mt-1">Define pipeline parameters and upload ILI data for alignment processing.</p>
        </div>
        <div className="mt-4 sm:mt-0 flex gap-3">
          <a 
            href={apiUrl('/api/download-template')}
            target="_blank"
            rel="noreferrer"
            className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-6 py-3 rounded-xl font-medium transition-colors shadow-sm flex items-center gap-2"
          >
            Download Excel Template
          </a>
          <button 
            onClick={handleInitialize}
            disabled={!allFilesUploaded || isProcessing}
            className={`px-8 py-3 rounded-xl font-medium transition-colors shadow-md flex items-center gap-2 ${allFilesUploaded && !isProcessing ? 'bg-brand-500 hover:bg-brand-600 text-white shadow-brand-500/20' : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'}`}
          >
            {isProcessing ? 'Reading Data...' : 'Initialize Alignment'}
          </button>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-6">
        {/* Left Column (Now Bottom): Asset & Specs */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          
          {/* Section 1: Asset Identification */}
          <div className="bg-white rounded-none shadow-sm border border-gray-100 overflow-hidden">
            <button 
              onClick={() => toggleSection('asset')}
              className="w-full px-6 py-4 flex justify-between items-center bg-gray-50/50 hover:bg-gray-50 transition-colors border-b border-gray-100"
            >
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FiInfo className="text-gray-500" /> Asset & Operations
              </h3>
              {isExpanded('asset') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('asset') && (
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pipeline Name (Session Name)</label>
                  <input type="text" value={sessionName} onChange={(e) => setSessionName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. SMR-SBY Gas Line" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Segment Route</label>
                  <input type="text" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. Station A - Station B" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>Onshore</option>
                    <option>Offshore</option>
                    <option>Subsea</option>
                    <option>Swamp</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Length (km)</label>
                  <input type="number" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="150" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product Medium</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>Natural Gas (Dry)</option>
                    <option>Natural Gas (Wet)</option>
                    <option>Crude Oil</option>
                    <option>Refined Product</option>
                    <option>Water</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">MAOP (psi)</label>
                  <input type="number" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. 1200" />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Physical Specs & Protection */}
          <div className="bg-white rounded-none shadow-sm border border-gray-100 overflow-hidden">
            <button 
              onClick={() => toggleSection('specs')}
              className="w-full px-6 py-4 flex justify-between items-center bg-gray-50/50 hover:bg-gray-50 transition-colors border-b border-gray-100"
            >
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FiSettings className="text-gray-500" /> Physical Specs & Protection
              </h3>
              {isExpanded('specs') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('specs') && (
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Outer Diameter (OD)</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>10 inch</option>
                    <option>12 inch</option>
                    <option>24 inch</option>
                    <option>36 inch</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nominal WT (mm)</label>
                  <input type="number" step="0.01" className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"   placeholder="e.g. 12.7" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Material Grade</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>API 5L X42</option>
                    <option>API 5L X52</option>
                    <option>API 5L X60</option>
                    <option>API 5L X65</option>
                    <option>API 5L X70</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Seam Type</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>SMLS (Seamless)</option>
                    <option>ERW</option>
                    <option>DSAW</option>
                    <option>SAWH</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">External Coating</label>
                  <select className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"  >
                    <option>3LPE</option>
                    <option>FBE</option>
                    <option>Coal Tar Enamel (CTE)</option>
                    <option>Bare</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Inst. Year / Loc Class</label>
                  <div className="flex gap-2">
                    <input type="text" className="w-1/2 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 outline-none"   placeholder="Year" />
                    <select className="w-1/2 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 outline-none bg-white"  >
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
        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-none shadow-sm border border-gray-100 overflow-hidden h-full flex flex-col">
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex justify-between items-center flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <FiShield className="text-gray-500" /> ILI Data Configuration
                </h3>
                {algorithm !== 'phylogenetic' && datasets.length < 5 && (
                  <button 
                    onClick={() => setDatasets([...datasets, { id: Date.now(), year: '', vendor: 'Rosen', file: null }])}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:border-brand-500 hover:text-brand-500 hover:bg-brand-50 transition-all bg-white shadow-sm"
                  >
                    <FiPlus size={14} /> Add another ILI data
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">Algorithm Strategy:</label>
                <select 
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none bg-white font-medium text-brand-600 shadow-sm"
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value)}
                >
                  <option value="dtw_hungarian">DTW + Hungarian Match</option>
                  <option value="traditional_hungarian">Traditional Hungarian</option>
                  <option value="manual">Manual Algorithm</option>
                  <option value="phylogenetic">Phylogenetic Algorithm</option>
                </select>
              </div>
              {algorithm !== 'phylogenetic' && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2 cursor-pointer">
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
            
            <div className="p-6 flex-1 flex gap-6 overflow-x-auto snap-x pb-4 no-scrollbar">
              
              {datasets.map((ds, index) => {
                const isMaster = index === masterIndex;
                return (
                  <div key={ds.id} className={`flex-1 min-w-[400px] max-w-[600px] p-5 rounded-xl border snap-start ${isMaster ? 'border-brand-500 bg-brand-50/30 ring-2 ring-brand-500/20' : 'border-gray-200 bg-gray-50/30'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-6 rounded-full ${isMaster ? 'bg-brand-500' : 'bg-gray-400'}`}></div>
                        <h4 className={`font-bold ${isMaster ? 'text-brand-700' : 'text-gray-700'}`}>
                          {algorithm === 'phylogenetic' ? ds.phyloLabel : `Dataset ${ds.year ? ds.year : ''}`}
                        </h4>
                      </div>
                      {algorithm !== 'phylogenetic' ? (
                        <button 
                          onClick={() => setMasterIndex(index)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isMaster ? 'bg-brand-500 text-white shadow-md' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                        >
                          <FiStar className={isMaster ? "fill-white" : ""} size={14} /> {isMaster ? 'Master Data' : 'Set as Master'}
                        </button>
                      ) : (
                        isMaster && (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-500 text-white shadow-md">
                            <FiStar className="fill-white" size={14} /> Master Data
                          </div>
                        )
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
                        <select 
                          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none bg-white"
                          value={ds.vendor}
                          onChange={(e) => {
                            const newDs = [...datasets];
                            newDs[index].vendor = e.target.value;
                            setDatasets(newDs);
                          }}
                        >
                          <option>Rosen</option>
                          <option>Baker Hughes</option>
                          <option>NDT Global</option>
                          <option>TDW</option>
                          <option>Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Year & Tool</label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            className="w-1/3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none" 
                            placeholder="YYYY" 
                            value={ds.year}
                            onChange={(e) => {
                              const newDs = [...datasets];
                              newDs[index].year = e.target.value;
                              setDatasets(newDs);
                            }}
                          />
                          <select className="w-2/3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 outline-none bg-white">
                            <option>MFL-A</option>
                            <option>MFL-C</option>
                            <option>UT-WM</option>
                            <option>Combo</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center bg-white transition-colors cursor-pointer group relative ${isMaster ? 'border-brand-300 hover:border-brand-500 hover:bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'}`}>
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
