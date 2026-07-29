import { useState, useEffect, useRef } from 'react';
import { FiUploadCloud, FiInfo, FiChevronDown, FiChevronUp, FiDatabase, FiSettings, FiShield, FiPlus, FiDownload, FiArrowRight } from 'react-icons/fi';
import { apiFetch, apiUrl } from '../utils/api';
import { Button, LinkButton } from '../components/ds';
import { useToast } from '../components/common/ToastProvider';
import { formatIngestionImportError } from '../domain/ingestionError';
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
  MOCK_ENGINE_NOT_VALIDATED: 'engine not yet validated',
  UNKNOWN_STRATEGY: 'unknown strategy',
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
  return `${name} — unavailable${reason ? ` (${reason})` : ''}`;
}

function fileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem || 'ILI Alignment';
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError');
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort);
  });
}

async function waitForIngestion(
  jobId: string,
  fileName: string,
  setLabel: (value: string) => void,
  signal?: AbortSignal,
) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    // An unmounted uploader must stop polling immediately instead of keeping
    // this loop alive for up to 15 minutes.
    if (signal?.aborted) throw abortError();
    const job = await apiFetch<IngestionResponse>(`/api/ingestion-jobs/${encodeURIComponent(jobId)}`, { signal });
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
    await wait(1_000, signal);
  }
  throw new Error('Ingestion job timed out. Reopen the session to check its status.');
}

export default function StepUploadILI({ onNext }: StepUploadILIProps) {
  const toast = useToast();
  const [expandedSection, setExpandedSection] = useState<string | null>('all');
  const [datasets, setDatasets] = useState<any[]>([{ id: 1, year: '', vendor: '', file: null }, { id: 2, year: '', vendor: '', file: null }]);
  const [masterIndex, setMasterIndex] = useState(1);
  const [algorithm, setAlgorithm] = useState('dtw_hungarian_onedirection');
  const [enablePartialRun, setEnablePartialRun] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [pipelineData, setPipelineData] = useState({
    segmentRoute: '',
    environment: '',
    lengthKm: '',
    productMedium: '',
    maopPsi: '',
    designPressureMpa: '',
    operatingPressureMpa: '',
    outerDiameter: '',
    nominalWtMm: '',
    materialGrade: '',
    smysMpa: '',
    designFactor: '',
    seamType: '',
    externalCoating: '',
    installationYear: '',
    buildYear: '',
    designLifeYears: '',
    locationClass: '',
  });
  const setPipelineField = (field: keyof typeof pipelineData, value: string) => {
    setPipelineData((current) => ({ ...current, [field]: value }));
  };
  // Aborts in-flight ingestion work (upload + status polling) on unmount and
  // suppresses state updates that would otherwise land after navigation.
  const unmountAbortRef = useRef<AbortController | null>(null);
  const [strategies, setStrategies] = useState<StrategyCapability[]>(() =>
    STRATEGY_ORDER.map((id) => ({
      id,
      available: FALLBACK_AVAILABLE.has(id),
      validated: FALLBACK_AVAILABLE.has(id),
      reasonCode: FALLBACK_AVAILABLE.has(id) ? null : 'MOCK_ENGINE_NOT_VALIDATED',
    })),
  );

  useEffect(() => {
    const controller = new AbortController();
    unmountAbortRef.current = controller;
    return () => controller.abort();
  }, []);

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
    const signal = unmountAbortRef.current?.signal;
    const setLabelIfMounted = (value: string) => {
      if (!signal?.aborted) setProcessingLabel(value);
    };
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
        setLabelIfMounted(`Importing ${index + 1} of ${datasets.length}: ${dataset.file.name}`);
        const formData = new FormData();
        formData.append('file', dataset.file);
        formData.append('pipelineName', pipelineName);
        formData.append('surveyYear', dataset.year);
        formData.append('vendor', dataset.vendor);
        const queued = await apiFetch<IngestionResponse>('/api/upload-csv', {
          method: 'POST',
          body: formData,
          signal,
        });
        const response = queued.jobId
          ? await waitForIngestion(String(queued.jobId), dataset.file.name, setLabelIfMounted, signal)
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

      if (signal?.aborted) return;
      const inspectionRuns = [
        {
          role: 'Master',
          year: runPair.masterRun.year,
          vendor: runPair.masterRun.vendor,
          fileName: runPair.masterRun.name,
          runId: runPair.masterRun.runId,
          total: runPair.masterRun.total,
        },
        ...runPair.historicalRuns.map((run) => ({
          role: 'Historical',
          year: run.year,
          vendor: run.vendor,
          fileName: run.name,
          runId: run.runId,
          total: run.total,
        })),
      ];
      onNext({
        summaryData,
        algorithm,
        enablePartialRun,
        pipelineData: {
          pipelineName,
          ...pipelineData,
          inspectionRuns,
        },
      });
    } catch (err) {
      // Unmounted mid-flight: the abort is intentional, keep quiet.
      if (signal?.aborted) return;
      console.error(err);
      toast.error(formatIngestionImportError(err));
    } finally {
      if (!signal?.aborted) {
        setIsProcessing(false);
        setProcessingLabel('');
      }
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
          <div className="ds-btn-group">
            <LinkButton
              variant="secondary"
              href={apiUrl('/api/download-template')}
              target="_blank"
              rel="noreferrer"
              startIcon={<FiDownload aria-hidden="true" />}
            >
              Download Excel template
            </LinkButton>
            <Button
              onClick={handleInitialize}
              disabled={!allFilesUploaded || isProcessing}
              endIcon={allFilesUploaded && !isProcessing ? <FiArrowRight aria-hidden="true" /> : undefined}
            >
              {isProcessing ? processingLabel || 'Importing data…' : 'Initialize alignment'}
            </Button>
          </div>
        </div>
      </section>

      {isProcessing && (
        <section className="alignment-import-progress" role="status" aria-live="polite">
          <div className="alignment-import-progress__orb" aria-hidden="true"><i /><i /></div>
          <div className="alignment-import-progress__copy">
            <span>Building canonical inspection registry</span>
            <strong>{processingLabel || 'Reading uploaded ILI rows…'}</strong>
            <small>Validating columns, normalizing feature types, and preserving source-row identity.</small>
          </div>
          <div className="alignment-import-progress__rail" aria-hidden="true"><i /></div>
          <div className="alignment-import-progress__facts">
            <span>Schema mapping</span>
            <span>Run chronology</span>
            <span>GW inventory</span>
            <span>Source evidence</span>
          </div>
        </section>
      )}

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
                <div className="sm:col-span-2">
                  <label className="ds-field__label">Pipeline Name (From — To)</label>
                  <input type="text" value={sessionName} onChange={(e) => setSessionName(e.target.value)} className="ds-input" placeholder="e.g. Station A — Station B" />
                </div>
                <div>
                  <label className="ds-field__label">Environment</label>
                  <select className="ds-select" value={pipelineData.environment} onChange={(event) => setPipelineField('environment', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="Onshore">Onshore</option>
                    <option value="Offshore">Offshore</option>
                    <option value="Subsea">Subsea</option>
                    <option value="Swamp">Swamp</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">Pipe Length (km)</label>
                  <input type="number" value={pipelineData.lengthKm} onChange={(event) => setPipelineField('lengthKm', event.target.value)} className="ds-input" placeholder="e.g. 150" />
                </div>
                <div>
                  <label className="ds-field__label">Product Medium</label>
                  <select className="ds-select" value={pipelineData.productMedium} onChange={(event) => setPipelineField('productMedium', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="Natural Gas (Dry)">Natural Gas (Dry)</option>
                    <option value="Natural Gas (Wet)">Natural Gas (Wet)</option>
                    <option value="Crude Oil">Crude Oil</option>
                    <option value="Refined Product">Refined Product</option>
                    <option value="Water">Water</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">Build Year</label>
                  <input type="text" value={pipelineData.buildYear} onChange={(event) => setPipelineField('buildYear', event.target.value)} className="ds-input" placeholder="e.g. 1995" />
                </div>
                <div>
                  <label className="ds-field__label">Design Life (years)</label>
                  <input type="number" value={pipelineData.designLifeYears} onChange={(event) => setPipelineField('designLifeYears', event.target.value)} className="ds-input" placeholder="e.g. 30" />
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
                  <label className="ds-field__label">Outer Diameter (OD)</label>
                  <input type="text" value={pipelineData.outerDiameter} onChange={(event) => setPipelineField('outerDiameter', event.target.value)} className="ds-input" placeholder="e.g. 10 inch or 273.1 mm" />
                </div>
                <div>
                  <label className="ds-field__label">Nominal WT (mm)</label>
                  <input type="number" step="0.01" value={pipelineData.nominalWtMm} onChange={(event) => setPipelineField('nominalWtMm', event.target.value)} className="ds-input" placeholder="e.g. 12.7" />
                </div>
                <div>
                  <label className="ds-field__label">MAOP (psi)</label>
                  <input type="number" value={pipelineData.maopPsi} onChange={(event) => setPipelineField('maopPsi', event.target.value)} className="ds-input" placeholder="e.g. 1200" />
                </div>
                <div>
                  <label className="ds-field__label">Design Pressure (MPa)</label>
                  <input type="number" step="0.01" value={pipelineData.designPressureMpa} onChange={(event) => setPipelineField('designPressureMpa', event.target.value)} className="ds-input" placeholder="e.g. 10.0" />
                </div>
                <div>
                  <label className="ds-field__label">Operating Pressure (MPa)</label>
                  <input type="number" step="0.01" value={pipelineData.operatingPressureMpa} onChange={(event) => setPipelineField('operatingPressureMpa', event.target.value)} className="ds-input" placeholder="e.g. 9.46" />
                </div>
                <div>
                  <label className="ds-field__label">Design Factor</label>
                  <input type="number" step="0.01" value={pipelineData.designFactor} onChange={(event) => setPipelineField('designFactor', event.target.value)} className="ds-input" placeholder="e.g. 0.72" />
                </div>
                <div>
                  <label className="ds-field__label">Material Grade</label>
                  <select className="ds-select" value={pipelineData.materialGrade} onChange={(event) => setPipelineField('materialGrade', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="API 5L X42">API 5L X42</option>
                    <option value="API 5L X52">API 5L X52</option>
                    <option value="API 5L X60">API 5L X60</option>
                    <option value="API 5L X65">API 5L X65</option>
                    <option value="API 5L X70">API 5L X70</option>
                    <option value="API 5L X80">API 5L X80</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">SMYS (MPa)</label>
                  <input type="number" step="0.1" value={pipelineData.smysMpa} onChange={(event) => setPipelineField('smysMpa', event.target.value)} className="ds-input" placeholder="e.g. 358.5" />
                </div>
                <div>
                  <label className="ds-field__label">Seam Type</label>
                  <select className="ds-select" value={pipelineData.seamType} onChange={(event) => setPipelineField('seamType', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="SMLS (Seamless)">SMLS (Seamless)</option>
                    <option value="ERW">ERW</option>
                    <option value="DSAW">DSAW</option>
                    <option value="SAWH">SAWH</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">External Coating</label>
                  <select className="ds-select" value={pipelineData.externalCoating} onChange={(event) => setPipelineField('externalCoating', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="3LPE">3LPE</option>
                    <option value="FBE">FBE</option>
                    <option value="Coal Tar Enamel (CTE)">Coal Tar Enamel (CTE)</option>
                    <option value="Bare">Bare</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">Inst. Year / Loc Class</label>
                  <div className="flex gap-2">
                    <input type="text" value={pipelineData.installationYear} onChange={(event) => setPipelineField('installationYear', event.target.value)} className="ds-input" placeholder="Year" />
                    <select className="ds-select" value={pipelineData.locationClass} onChange={(event) => setPipelineField('locationClass', event.target.value)}>
                      <option value="">Not provided</option>
                      <option value="Class 1">Class 1</option>
                      <option value="Class 2">Class 2</option>
                      <option value="Class 3">Class 3</option>
                      <option value="Class 4">Class 4</option>
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
                  <Button
                    size="sm"
                    variant="secondary"
                    startIcon={<FiPlus aria-hidden="true" />}
                    onClick={() => setDatasets([...datasets, { id: Date.now(), year: '', vendor: '', file: null }])}
                  >
                    Add another ILI data
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Strategy</label>
                <select
                  className="ds-select ds-select--sm"
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
                          className="ds-input" style={{ marginTop: '0.3rem' }}
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
                          className="ds-input" style={{ marginTop: '0.3rem' }}
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
