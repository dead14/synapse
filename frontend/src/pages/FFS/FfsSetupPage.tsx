import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { FiUploadCloud, FiSettings, FiDownload, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { downloadCsvTemplate } from '../../lib/ffs/csvTemplate';
import { validateHeaders, validateData } from '../../lib/ffs/validation';
import type { ValidationError } from '../../lib/ffs/validation';
import { processAllRows } from '../../lib/ffs/calcEngine';
import type { FfsConfig } from '../../lib/ffs/types';

export default function FfsSetupPage() {
  const navigate = useNavigate();
  
  // Setup State
  const [lineName, setLineName] = useState('');
  const [method, setMethod] = useState<'original' | 'modified'>('modified');
  const [modifiedSa, setModifiedSa] = useState<'smys69' | 'smys11'>('smys69');
  const [iliDate, setIliDate] = useState('');
  const [highlightYears, setHighlightYears] = useState(5);
  
  // File State
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'import'>('upload');

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
      alert('Please select an ILI Inspection Date');
      return;
    }
    if (!lineName) {
      alert('Please enter a Pipeline / Line Name');
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
          alert(`Missing required columns: \n${missing.join('\n')}`);
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
        navigate('/ffs/results', { state: { results: ffsResults, config } });
      },
      error: (err) => {
        alert('CSV parse error: ' + err.message);
        setIsProcessing(false);
      }
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageMeta
        title="FFS Pipeline Assessment"
        description="ASME B31G Modified"
      />

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
            
            <div>
              <p className="text-xs text-slate-500 mb-2">Download the required CSV template with all 14 column headers and a sample data row.</p>
              <button onClick={downloadCsvTemplate} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800/50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 transition-colors">
                <FiDownload /> Download CSV Template
              </button>
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

              <button 
                onClick={runAssessment}
                disabled={!file || !iliDate || !lineName || isProcessing}
                className="w-full mt-6 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
              <p className="text-sm text-slate-500">ILI Alignment Import feature is currently under development.</p>
              <button 
                onClick={() => setActiveTab('upload')}
                className="mt-4 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Switch to CSV Upload
              </button>
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
