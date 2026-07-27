import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { FiUploadCloud, FiSettings, FiDownload, FiCheckCircle, FiAlertCircle, FiDatabase, FiRefreshCw } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { downloadCsvTemplate } from '../../lib/ffs/csvTemplate';
import { validateHeaders, validateData } from '../../lib/ffs/validation';
import type { ValidationError } from '../../lib/ffs/validation';
import { processAllRows } from '../../lib/ffs/calcEngine';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig, type FfsScreeningConfig } from '../../lib/ffs/types';
import SynButton from '../../components/ui/SynButton';
import { NumberField } from '../../components/ffs/FfsPrimitives';
import { apiFetch } from '../../utils/api';
import { fetchAlignmentResult, type ComparisonRow } from '../../utils/alignment';
import { getAlignmentImportReadiness, mapAlignmentRowsToFfs } from '../../lib/ffs/alignmentImport';
import { useToast } from '../../components/common/ToastProvider';

interface PipelineRun {
  id: string;
  pipelineName: string;
  date: string;
  status: string;
  matchRate?: number | null;
  anomaliesFound: number;
  vendorLama: string;
  vendorBaru: string;
}

export default function FfsSetupPage() {
  const navigate = useNavigate();
  const toast = useToast();

  // Setup State
  const [lineName, setLineName] = useState('');
  const [method, setMethod] = useState<'original' | 'modified'>('modified');
  const [modifiedSa, setModifiedSa] = useState<'smys69' | 'smys11'>('smys69');
  const [iliDate, setIliDate] = useState('');
  const [highlightYears, setHighlightYears] = useState(5);
  const [screening, setScreening] = useState<FfsScreeningConfig>(DEFAULT_SCREENING_CONFIG);
  const [screeningOpen, setScreeningOpen] = useState(false);

  // File State
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'import'>('upload');
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [alignmentRows, setAlignmentRows] = useState<ComparisonRow[]>([]);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [alignmentMessage, setAlignmentMessage] = useState('');
  const [alignmentError, setAlignmentError] = useState('');
  const [outerDiameterMm, setOuterDiameterMm] = useState('');
  const [smysMpa, setSmysMpa] = useState('');
  const [designFactor, setDesignFactor] = useState('0.72');
  const [operatingPressureMpa, setOperatingPressureMpa] = useState('');
  const [fallbackDepthGrowth, setFallbackDepthGrowth] = useState('0');
  const [fallbackLengthGrowth, setFallbackLengthGrowth] = useState('0');
  const alignmentReadinessReasons = getAlignmentImportReadiness({
    lineName,
    iliDate,
    selectedRunId,
    alignmentRowCount: alignmentRows.length,
    outerDiameterMm,
    smysMpa,
    designFactor,
    operatingPressureMpa,
    fallbackDepthGrowthMmPerYear: fallbackDepthGrowth,
    fallbackLengthGrowthMmPerYear: fallbackLengthGrowth,
  });

  useEffect(() => {
    if (activeTab !== 'import' || runs.length > 0) return;
    let cancelled = false;
    setAlignmentLoading(true);
    setAlignmentError('');
    apiFetch<PipelineRun[]>('/api/pipeline-runs')
      .then((availableRuns) => {
        if (cancelled) return;
        const completed = availableRuns.filter((run) => run.status === 'completed');
        setRuns(completed);
        const requested = new URLSearchParams(window.location.search).get('sessionId')
          || localStorage.getItem('synapse_last_session_id')
          || '';
        const initial = completed.some((run) => run.id === requested) ? requested : completed[0]?.id || '';
        setSelectedRunId(initial);
      })
      .catch((caught) => {
        if (!cancelled) setAlignmentError(caught instanceof Error ? caught.message : 'The alignment history could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setAlignmentLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab, runs.length]);

  useEffect(() => {
    if (activeTab !== 'import' || !selectedRunId || alignmentRows.length > 0 || alignmentLoading) return;
    void loadAlignment();
    // loadAlignment intentionally runs when a new completed session is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedRunId]);

  const handleFileDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const runAssessment = () => {
    if (!file) return;
    if (!iliDate) {
      toast.error('Select an ILI inspection date first.');
      return;
    }
    if (!lineName) {
      toast.error('Enter a pipeline / line name first.');
      return;
    }

    setIsProcessing(true);
    setErrors([]);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const missing = validateHeaders(results.meta.fields || []);
        if (missing.length > 0) {
          toast.error(`Missing required columns:\n${missing.join('\n')}`);
          setIsProcessing(false);
          return;
        }

        const dataErrors = validateData(results.data as Record<string, string>[]);
        if (dataErrors.length > 0) {
          setErrors(dataErrors);
          setIsProcessing(false);
          return;
        }

        const config: FfsConfig = {
          lineName,
          method,
          modifiedSa,
          iliDate: new Date(iliDate),
          highlightYears
        };

        const ffsResults = await processAllRows(results.data as Record<string, string>[], config, (pct) => {
          setProgress(pct);
        });

        // Store results in location state (or a context if preferred) and navigate
        navigate('/ffs/results', { state: { results: ffsResults, config, screening } });
      },
      error: (err) => {
        toast.error('CSV parse error: ' + err.message);
        setIsProcessing(false);
      }
    });
  };

  const loadAlignment = async () => {
    if (!selectedRunId) return;
    setAlignmentLoading(true);
    setAlignmentError('');
    setAlignmentRows([]);
    try {
      const result = await fetchAlignmentResult(selectedRunId, (pct, message) => {
        setProgress(pct);
        setAlignmentMessage(message);
      });
      setAlignmentRows(result.comparison);
      setAlignmentMessage(`${result.comparison.length.toLocaleString()} comparison rows loaded.`);
      const selected = runs.find((run) => run.id === selectedRunId);
      if (!lineName && selected) setLineName(selected.pipelineName);
    } catch (caught) {
      setAlignmentError(caught instanceof Error ? caught.message : 'The alignment results could not be loaded.');
    } finally {
      setAlignmentLoading(false);
    }
  };

  const runAlignmentAssessment = async () => {
    if (!lineName || !iliDate || !selectedRunId || alignmentRows.length === 0) return;
    setIsProcessing(true);
    setErrors([]);
    setAlignmentError('');
    try {
      const imported = mapAlignmentRowsToFfs(alignmentRows, {
        outerDiameterMm: Number(outerDiameterMm),
        smysMpa: Number(smysMpa),
        designFactor: Number(designFactor),
        operatingPressureMpa: Number(operatingPressureMpa),
        fallbackDepthGrowthMmPerYear: Number(fallbackDepthGrowth),
        fallbackLengthGrowthMmPerYear: Number(fallbackLengthGrowth),
      }, selectedRunId);
      if (imported.accepted.length === 0) {
        throw new Error(imported.rejected[0]?.reason || 'No NEW-run anomalies are eligible for FFS assessment.');
      }
      const rows = imported.accepted.map((item) => item.row);
      const dataErrors = validateData(rows);
      if (dataErrors.length > 0) {
        setErrors(dataErrors);
        return;
      }
      const config: FfsConfig = {
        lineName,
        method,
        modifiedSa,
        iliDate: new Date(iliDate),
        highlightYears,
      };
      const ffsResults = await processAllRows(rows, config, setProgress);
      navigate('/ffs/results', {
        state: {
          results: ffsResults,
          config,
          screening,
          alignmentImport: {
            sessionId: selectedRunId,
            accepted: imported.accepted.map((item) => item.provenance),
            rejected: imported.rejected,
            warningCount: imported.accepted.reduce((sum, item) => sum + item.warnings.length, 0),
          },
        },
      });
    } catch (caught) {
      setAlignmentError(caught instanceof Error ? caught.message : 'The alignment import could not be processed.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta
        title="FFS Pipeline Assessment"
        description="ASME B31G Modified"
      />

      <div className="syn-page__header">
        <div>
          <p className="syn-eyebrow">Fitness-for-service</p>
          <h1 className="syn-page__title">Assessment setup</h1>
          <p className="syn-page__subtitle">Configure the method, verify source data, and run a traceable B31G assessment.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* LEFT COLUMN: SETUP */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wide text-sm mb-5">
            <FiSettings className="w-5 h-5" />
            Assessment Setup
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                Pipeline / Line Name <span className="text-red-500">*</span>
              </label>
              <input 
                type="text" 
                value={lineName}
                onChange={e => setLineName(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                placeholder="e.g. 20in CPA - PK6.3"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                Assessment Method <span className="text-red-500">*</span>
              </label>
              <div className="flex bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1">
                <button 
                  onClick={() => setMethod('original')}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-semibold flex flex-col items-center transition-colors ${method === 'original' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <span>Original B31G</span>
                  <span className="text-[10px] opacity-70">0.67dL</span>
                </button>
                <button 
                  onClick={() => setMethod('modified')}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-semibold flex flex-col items-center transition-colors ${method === 'modified' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <span>Modified B31G</span>
                  <span className="text-[10px] opacity-70">0.85dL</span>
                </button>
              </div>
              
              {method === 'modified' && (
                <div className="flex items-center gap-3 mt-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                  <span className="text-xs text-slate-500 font-medium">Modified S<sub>f</sub> formula:</span>
                  <div className="flex bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 p-0.5">
                    <button 
                      onClick={() => setModifiedSa('smys69')}
                      className={`px-2 py-1 text-[11px] font-medium rounded ${modifiedSa === 'smys69' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-500'}`}
                    >
                      SMYS + 69 MPa
                    </button>
                    <button 
                      onClick={() => setModifiedSa('smys11')}
                      className={`px-2 py-1 text-[11px] font-medium rounded ${modifiedSa === 'smys11' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-500'}`}
                    >
                      1.1 × SMYS
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                ILI Inspection Date <span className="text-red-500">*</span>
              </label>
              <input 
                type="date" 
                value={iliDate}
                onChange={e => setIliDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                Highlight Threshold
              </label>
              <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 focus-within:border-indigo-500">
                <span className="bg-slate-100 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-500 border-r border-slate-200 dark:border-slate-700">Expected Life &lt;</span>
                <input 
                  type="number" 
                  value={highlightYears}
                  onChange={e => setHighlightYears(parseFloat(e.target.value))}
                  className="flex-1 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none"
                  min="0" step="0.5"
                />
              </div>
            </div>
            
            <div className="h-px bg-slate-200 dark:bg-slate-700 my-4"></div>

            {/* Screening assumptions — project decisions, not code requirements */}
            <div>
              <button
                type="button"
                onClick={() => setScreeningOpen((open) => !open)}
                aria-expanded={screeningOpen}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-700"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Screening assumptions
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                    ILI tolerance, growth rate, forecast horizon, review band
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                  {screeningOpen ? 'Hide' : 'Adjust'}
                </span>
              </button>

              {screeningOpen && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="ILI depth tolerance"
                      value={screening.depthTolerancePct}
                      onChange={(depthTolerancePct) => setScreening((s) => ({ ...s, depthTolerancePct }))}
                      unit="% WT"
                      min={0}
                      step={0.5}
                    />
                    <NumberField
                      label="ILI length tolerance"
                      value={screening.lengthToleranceMm}
                      onChange={(lengthToleranceMm) => setScreening((s) => ({ ...s, lengthToleranceMm }))}
                      unit="mm/end"
                      min={0}
                      step={1}
                    />
                    <NumberField
                      label="Growth rate"
                      value={screening.growthRateMmPerYear}
                      onChange={(growthRateMmPerYear) => setScreening((s) => ({ ...s, growthRateMmPerYear }))}
                      unit="mm/y"
                      min={0}
                      step={0.01}
                    />
                    <NumberField
                      label="Forecast horizon"
                      value={screening.forecastYears}
                      onChange={(forecastYears) => setScreening((s) => ({ ...s, forecastYears }))}
                      unit="years"
                      min={1}
                      max={50}
                      step={1}
                    />
                    <NumberField
                      label="Review band"
                      value={screening.reviewBandErf}
                      onChange={(reviewBandErf) => setScreening((s) => ({ ...s, reviewBandErf }))}
                      unit="ERF"
                      min={0.5}
                      max={1}
                      step={0.01}
                    />
                    <NumberField
                      label="Interaction spacing"
                      value={screening.interactionSpacingFactor}
                      onChange={(interactionSpacingFactor) =>
                        setScreening((s) => ({ ...s, interactionSpacingFactor }))
                      }
                      unit="× t"
                      min={1}
                      max={20}
                      step={1}
                    />
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    These are project screening decisions, not ASME B31G requirements. They can also be retuned
                    on the results page without re-running the parse.
                  </p>
                </div>
              )}
            </div>

            <div className="h-px bg-slate-200 dark:bg-slate-700 my-4"></div>

            <div>
              <p className="text-xs text-slate-500 mb-2">Download the required CSV template with all 14 column headers and a sample data row.</p>
              <SynButton type="button" variant="outline" size="sm" onClick={downloadCsvTemplate} className="inline-flex items-center gap-2">
                <FiDownload /> Download CSV Template
              </SynButton>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: UPLOAD/IMPORT */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wide text-sm mb-5">
            <FiUploadCloud className="w-5 h-5" />
            Data Source
          </div>

          <div className="flex border-b border-slate-200 dark:border-slate-700 mb-6">
            <button 
              onClick={() => setActiveTab('upload')}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'upload' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Upload CSV Data
            </button>
            <button 
              onClick={() => setActiveTab('import')}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'import' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Import from ILI Alignment
            </button>
          </div>

          {activeTab === 'upload' ? (
            <div className="flex-1 flex flex-col">
              <label 
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
                className={`flex-1 min-h-[160px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-colors ${file ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/10' : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
              >
                <input type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
                <FiUploadCloud className={`w-10 h-10 mb-3 ${file ? 'text-indigo-500' : 'text-slate-400'}`} />
                {file ? (
                  <>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{file.name}</span>
                    <span className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Drop CSV file here or click to browse</span>
                    <span className="text-xs text-slate-500 mt-1">Supports files up to 99,999 rows</span>
                  </>
                )}
              </label>

              <SynButton
                onClick={runAssessment}
                disabled={!file || !iliDate || !lineName || isProcessing}
                variant="lime"
                size="lg"
                className="w-full mt-6 inline-flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing ({progress}%)
                  </>
                ) : (
                  <>
                    <FiCheckCircle /> Run Assessment
                  </>
                )}
              </SynButton>
            </div>
          ) : (
            <div className="flex-1 space-y-4">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
                <div className="flex items-start gap-3">
                  <FiDatabase className="mt-0.5 h-5 w-5 text-indigo-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Use latest-run anomalies from Alignment</p>
                    <p className="mt-1 text-xs text-slate-500">Measured NEW-run geometry and corrosion growth are retained with session and feature provenance.</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Completed alignment session</label>
                <div className="flex gap-2">
                  <select
                    value={selectedRunId}
                    onChange={(event) => {
                      setSelectedRunId(event.target.value);
                      setAlignmentRows([]);
                      setAlignmentMessage('');
                    }}
                    disabled={alignmentLoading}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="">Select an alignment run</option>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.pipelineName} · {run.vendorLama} → {run.vendorBaru}
                      </option>
                    ))}
                  </select>
                  <SynButton type="button" variant="outline" size="sm" onClick={() => void loadAlignment()} disabled={!selectedRunId || alignmentLoading}>
                    <span className="inline-flex items-center gap-2"><FiRefreshCw className={alignmentLoading ? 'animate-spin' : ''} /> Load</span>
                  </SynButton>
                </div>
                {runs.length === 0 && !alignmentLoading && !alignmentError && (
                  <p className="mt-2 text-xs text-amber-600">No completed alignment session is available.</p>
                )}
                {alignmentMessage && <p className="mt-2 text-xs font-medium text-emerald-600">{alignmentMessage}</p>}
                {alignmentError && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{alignmentError}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Outer Diameter [mm]', outerDiameterMm, setOuterDiameterMm],
                  ['SMYS [MPa]', smysMpa, setSmysMpa],
                  ['Design Factor', designFactor, setDesignFactor],
                  ['Operating Pressure [MPa]', operatingPressureMpa, setOperatingPressureMpa],
                  ['Fallback CR Depth [mm/y]', fallbackDepthGrowth, setFallbackDepthGrowth],
                  ['Fallback CR Length [mm/y]', fallbackLengthGrowth, setFallbackLengthGrowth],
                ].map(([label, value, setter]) => (
                  <label key={label as string} className="block text-xs font-semibold text-slate-500">
                    {label as string}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={value as string}
                      onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">Fallback growth rates are only used when a matched anomaly has no measured growth. Use 0 only when that engineering assumption is intentional.</p>
              {alignmentReadinessReasons.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <p className="font-semibold">Complete these items to run the assessment:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {alignmentReadinessReasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              )}

              <SynButton
                onClick={() => void runAlignmentAssessment()}
                disabled={alignmentReadinessReasons.length > 0 || isProcessing}
                variant="lime"
                size="lg"
                className="w-full inline-flex items-center justify-center gap-2"
              >
                {isProcessing ? `Processing (${progress}%)` : <><FiCheckCircle /> Import & Run Assessment</>}
              </SynButton>
            </div>
          )}
        </div>
      </div>

      {/* Validation Errors Display */}
      {errors.length > 0 && (
        <div className="mt-8 bg-white dark:bg-slate-800 rounded-xl border border-red-200 dark:border-red-900 overflow-hidden shadow-sm">
          <div className="bg-red-50 dark:bg-red-900/20 px-6 py-4 flex items-center gap-3 border-b border-red-100 dark:border-red-900/50">
            <FiAlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-red-700 dark:text-red-400 font-medium">Found {errors.length} validation error{errors.length > 1 ? 's' : ''} — please fix your CSV and re-upload.</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 uppercase text-xs font-semibold sticky top-0">
                <tr>
                  <th className="px-6 py-3">#</th>
                  <th className="px-6 py-3">Row</th>
                  <th className="px-6 py-3">Column</th>
                  <th className="px-6 py-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {errors.slice(0, 100).map((err, i) => (
                  <tr key={i}>
                    <td className="px-6 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-6 py-3 font-medium text-amber-600 dark:text-amber-500">Row {err.row}</td>
                    <td className="px-6 py-3 text-indigo-600 dark:text-indigo-400">{err.col}</td>
                    <td className="px-6 py-3 text-red-600 dark:text-red-400">{err.msg}</td>
                  </tr>
                ))}
                {errors.length > 100 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-3 text-center text-slate-500 italic">...and {errors.length - 100} more errors not shown.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
