import { useState, useEffect } from 'react';
import { FiUploadCloud, FiInfo, FiChevronDown, FiChevronUp, FiDatabase, FiSettings, FiShield, FiPlus } from 'react-icons/fi';
import { apiFetch, apiUrl } from '../utils/api';
import {
  buildPersistedIliRun,
  ingestPersistedInspectionRunPair,
  type IngestionResponse,
} from '../domain/alignmentIntake';

interface StepUploadILIProps {
  onNext: (data?: any) => void;
}

type StrategyCapability = {
  id: string;
  available: boolean;
  validated: boolean;
  reasonCode: string | null;
};

const STRATEGY_LABELS: Record<string, string> = {
  dtw_hungarian_onedirection: 'DTW + Ordered Match (OneDirection)',
  dtw_hungarian: 'DTW + Hungarian Match (Legacy)',
  traditional_hungarian: 'Traditional Hungarian',
  manual: 'Manual Algorithm',
  phylogenetic: 'Phylogenetic Algorithm',
};

const STRATEGY_ORDER = [
  'dtw_hungarian_onedirection',
  'dtw_hungarian',
  'traditional_hungarian',
  'manual',
  'phylogenetic',
];

const UNAVAILABLE_REASONS: Record<string, string> = {
  MOCK_ENGINE_NOT_VALIDATED: 'engine belum divalidasi',
  UNKNOWN_STRATEGY: 'strategi tidak dikenal',
};

// Until the capability table arrives, only offer the engines the server is
// known to accept.  Guessing optimistically here would recreate the dead end
// this list exists to prevent: the wizard would take the operator through
// every remaining step before the execution endpoint rejects the choice.
const FALLBACK_AVAILABLE = new Set(['dtw_hungarian_onedirection', 'manual', 'phylogenetic']);

function strategyLabel(capability: StrategyCapability): string {
  const name = STRATEGY_LABELS[capability.id] || capability.id;
  if (capability.available) return name;
  const reason = capability.reasonCode ? UNAVAILABLE_REASONS[capability.reasonCode] : null;
  return `${name} — tidak tersedia${reason ? ` (${reason})` : ''}`;
}

function fileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem || 'ILI Alignment';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForIngestion(jobId: string, fileName: string, setLabel: (value: string) => void) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const job = await apiFetch<IngestionResponse>(`/api/ingestion-jobs/${encodeURIComponent(jobId)}`);
    setLabel(`Processing ${fileName}: ${Number(job.progress || 0)}%`);
    if (job.state === 'completed') {
      return {
        ...job,
        pipeline_run_id: job.result?.pipelineRunId,
        run_summary: job.result?.summary,
        audit: job.result?.audit,
      } satisfies IngestionResponse;
    }
    if (job.state === 'failed') {
      throw new Error(job.errorMessage || 'Ingestion failed.');
    }
    await wait(1_000);
  }
  throw new Error('Ingestion job timed out. Reopen the session to check its status.');
}

export default function StepUploadILI({ onNext }: StepUploadILIProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('all');
  const [datasets, setDatasets] = useState<any[]>([{ id: 1, year: '', vendor: '', file: null }, { id: 2, year: '', vendor: '', file: null }]);
  const [masterIndex, setMasterIndex] = useState(1);
  const [algorithm, setAlgorithm] = useState('dtw_hungarian_onedirection');
  const [enablePartialRun, setEnablePartialRun] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [strategies, setStrategies] = useState<StrategyCapability[]>(() =>
    STRATEGY_ORDER.map((id) => ({
      id,
      available: FALLBACK_AVAILABLE.has(id),
      validated: FALLBACK_AVAILABLE.has(id),
      reasonCode: FALLBACK_AVAILABLE.has(id) ? null : 'MOCK_ENGINE_NOT_VALIDATED',
    })),
  );

  useEffect(() => {
    let active = true;
    apiFetch<{ strategies?: StrategyCapability[] }>('/api/alignment/strategies')
      .then((payload) => {
        if (!active || !Array.isArray(payload.strategies) || payload.strategies.length === 0) return;
        const known = new Map(payload.strategies.map((item) => [item.id, item]));
        const ordered = STRATEGY_ORDER.filter((id) => known.has(id)).map((id) => known.get(id)!);
        const extra = payload.strategies.filter((item) => !STRATEGY_ORDER.includes(item.id));
        setStrategies([...ordered, ...extra]);
      })
      .catch(() => {
        // Keep the conservative fallback list; it never offers an engine the
        // execution endpoint would reject.
      });
    return () => { active = false; };
  }, []);

  // A capability can go unavailable between page loads.  Never leave a rejected
  // engine selected, or the wizard would advance on a choice that cannot run.
  useEffect(() => {
    const selected = strategies.find((item) => item.id === algorithm);
    if (selected && !selected.available) {
      const firstAvailable = strategies.find((item) => item.available);
      if (firstAvailable) setAlgorithm(firstAvailable.id);
    }
  }, [strategies, algorithm]);

  useEffect(() => {
    if (algorithm === 'phylogenetic') {
      setDatasets((prev) => {
        if (prev.length >= 3 && !prev[0].phyloLabel) {
          return prev.map((ds, i) => ({ ...ds, phyloLabel: i === 0 ? 'Ancestor Data' : `ILI Alignment ${i}` }));
        }
        if (prev.length < 3 || prev[0].phyloLabel) return prev;
        return [
          { id: 1, year: '', vendor: '', file: null, phyloLabel: 'Ancestor Data' },
          { id: 2, year: '', vendor: '', file: null, phyloLabel: 'ILI Alignment 1' },
          { id: 3, year: '', vendor: '', file: null, phyloLabel: 'ILI Alignment 2' },
        ];
      });
      setMasterIndex(0);
    } else {
      setMasterIndex((prev) => (prev === 0 ? 1 : prev));
      setDatasets((currentDatasets) => {
        if (currentDatasets[0]?.phyloLabel) {
          return currentDatasets.map(({ phyloLabel: _phyloLabel, ...rest }) => rest);
        }
        return currentDatasets;
      });
    }
  }, [algorithm]);

  const allFilesUploaded = datasets.every((ds) => (
    ds.file !== null && /^\d{4}$/.test(String(ds.year || '').trim()) && String(ds.vendor || '').trim().length > 0
  ));

  const handleInitialize = async () => {
    setIsProcessing(true);
    try {
      const masterFile = datasets[masterIndex]?.file as File | null;
      const pipelineName = sessionName.trim() || fileStem(masterFile?.name || 'ILI Alignment');
      const summaryData: any = {
        sessionName: sessionName || pipelineName,
        algorithm: algorithm,
        enablePartialRun: enablePartialRun
      };
      summaryData.newRun = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
      summaryData.oldRun = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };

      const ingestCallback = async (dataset: any, index: number) => {
        setProcessingLabel(`Importing ${index + 1} of ${datasets.length}: ${dataset.file.name}`);
        const formData = new FormData();
        formData.append('file', dataset.file);
        formData.append('pipelineName', pipelineName);
        formData.append('surveyYear', dataset.year);
        formData.append('vendor', dataset.vendor);
        const queued = await apiFetch<IngestionResponse>('/api/upload-csv', {
          method: 'POST',
          body: formData,
        });
        const response = queued.jobId
          ? await waitForIngestion(String(queued.jobId), dataset.file.name, setProcessingLabel)
          : queued;
        return buildPersistedIliRun(response, {
          name: dataset.file.name,
          vendor: dataset.vendor,
          year: dataset.year,
          tool: dataset.tool,
        });
      };

      const runPair = await ingestPersistedInspectionRunPair({
        datasets: datasets.map((dataset) => ({
          file: dataset.file as File,
          vendor: String(dataset.vendor || ''),
          year: String(dataset.year || ''),
          tool: String(dataset.tool || ''),
        })),
        masterIndex,
        ingest: ingestCallback,
      });
      Object.assign(summaryData, runPair);

      if (algorithm === 'phylogenetic') {
        const sorted = [...runPair.historicalRuns, runPair.masterRun]
          .sort((a, b) => Number(a.year || 0) - Number(b.year || 0));
        summaryData.ancestorRun = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          summaryData[`run${i}`] = sorted[i];
        }
      }

      onNext({ summaryData, algorithm, enablePartialRun });
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error && err.message ? `\n\nDetail: ${err.message}` : '';
      alert(`Gagal mengimpor file ILI. Pastikan format, tahun, vendor, dan header valid.${detail}`);
    } finally {
      setIsProcessing(false);
      setProcessingLabel('');
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
            {isProcessing ? processingLabel || 'Importing data...' : 'Initialize Alignment'}
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
                {datasets.length < 6 && (
                  <button
                    onClick={() => setDatasets([...datasets, { id: Date.now(), year: '', vendor: '', file: null }])}
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
                  {strategies.map((capability) => (
                    <option
                      key={capability.id}
                      value={capability.id}
                      disabled={!capability.available}
                    >
                      {strategyLabel(capability)}
                    </option>
                  ))}
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
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-slate-600">
                        Survey year
                        <input
                          type="number"
                          min="1900"
                          max="2100"
                          required
                          value={ds.year || ''}
                          onChange={(event) => setDatasets((current) => current.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, year: event.target.value } : item
                          )))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
                          placeholder="2026"
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-600">
                        Vendor
                        <input
                          type="text"
                          required
                          value={ds.vendor || ''}
                          onChange={(event) => setDatasets((current) => current.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, vendor: event.target.value } : item
                          )))}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
                          placeholder="e.g. ROSEN"
                        />
                      </label>
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
