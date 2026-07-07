import React, { useState, useEffect } from 'react';
import { FiCheckCircle, FiAlertTriangle, FiFileText, FiDownload } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

interface StepExecutionProps {
  onBack: () => void;
}

export default function StepExecution({ onBack }: StepExecutionProps) {
  const navigate = useNavigate();
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    // We simulate the backend event source streaming for this demo
    setTerminalLines([
      "Connecting to Alignment Server...",
      "INPUT DATA ILI LAMA (OLD)",
      "INPUT DATA ILI BARU (NEW)"
    ]);
    
    let timer1 = setTimeout(() => {
      setTerminalLines(prev => [...prev, "Memuat OLD: ILI_Data_2020.xlsx", "Memuat NEW: ILI_Data_2025.xlsx"]);
      setProgress(20);
    }, 1000);
    
    let timer2 = setTimeout(() => {
      setTerminalLines(prev => [...prev, "Pipeline length : 12536.0 m", "Running alignment v8.1..."]);
      setProgress(40);
    }, 2500);

    let timer3 = setTimeout(() => {
      setTerminalLines(prev => [
        ...prev, 
        "── FASE 1: Valve/Tee Anchor Validation ──",
        "── FASE 2: Girth Weld Pre-Alignment (DTW) ──",
        "── FASE 3: Hungarian Matcher (Joint-Centric) ──"
      ]);
      setProgress(70);
    }, 4000);

    let timer4 = setTimeout(() => {
      setTerminalLines(prev => [
        ...prev, 
        "── FASE 4: Anti-Jump Monotonicity Filter (LIS) ──",
        "── FASE 5: Naive Bayes Scoring & Physics Validation ──",
        "[GROWTH RATE] 12 pair lolos validasi fisika, 4 anomali depth berkurang",
        "[CLOCK INTEGRITY] 3 pair di-flag sebagai clock-shift outlier",
        "Building output: ILI_Comparison_Final.xlsx",
        "SELESAI: Matched=1,273  OnlyNEW=3,562  OnlyOLD=265"
      ]);
      setProgress(100);
      setShowValidation(true);
    }, 6000);

    return () => {
      clearTimeout(timer1); clearTimeout(timer2); clearTimeout(timer3); clearTimeout(timer4);
    };
  }, []);

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 animate-fade-in flex flex-col gap-6">
      
      {/* Terminal View */}
      <div className="flex-1 min-h-[300px] max-h-[400px] bg-gray-900 rounded-xl p-5 overflow-y-auto font-mono text-sm shadow-inner relative">
        {terminalLines.map((line, i) => (
          <div key={i} className={line.includes('ERROR') ? 'text-red-400' : line.includes('SELESAI') ? 'text-yellow-300 font-bold' : 'text-green-400'}>
            {line}
          </div>
        ))}
      </div>
      
      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
        <div className="bg-green-500 h-2 rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }}></div>
      </div>

      {/* Physics Validation Results (Shows up when progress is 100%) */}
      {showValidation && (
        <div className="animate-fade-in mt-4">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <FiCheckCircle className="text-green-500" /> Post-Alignment Validation Results
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="border border-red-100 bg-red-50/50 rounded-xl p-5">
               <h4 className="font-bold text-red-800 flex items-center gap-2 mb-3">
                 <FiAlertTriangle /> Physics Red Flags
               </h4>
               <ul className="text-sm text-red-700 space-y-2 list-disc list-inside">
                 <li><strong>4 Anomalies</strong> show impossible depth regression (Depth NEW &lt; Depth OLD).</li>
                 <li><strong>3 Anomalies</strong> flagged for severe orientation shift (&gt;45° clock rotation).</li>
                 <li><strong>1 Anomaly</strong> changed location classification (Internal to External).</li>
               </ul>
            </div>
            
            <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-5">
               <h4 className="font-bold text-blue-800 flex items-center gap-2 mb-3">
                 <FiCheckCircle /> Naive Bayes Confidence
               </h4>
               <ul className="text-sm text-blue-800 space-y-2">
                 <li className="flex justify-between items-center border-b border-blue-100 pb-1">
                   <span>High Confidence (&gt;90%)</span> <span className="font-bold">1,150 matches</span>
                 </li>
                 <li className="flex justify-between items-center border-b border-blue-100 pb-1">
                   <span>Medium Confidence (70-90%)</span> <span className="font-bold">103 matches</span>
                 </li>
                 <li className="flex justify-between items-center border-b border-blue-100 pb-1">
                   <span>Low Confidence (&lt;70%)</span> <span className="font-bold text-red-600">20 matches</span>
                 </li>
               </ul>
               <p className="text-xs text-blue-600 mt-3 italic">Low confidence matches usually indicate severe odometer drift or sensor noise around the anomaly.</p>
            </div>
          </div>
          
          <div className="flex gap-4 justify-end mt-4">
            <a
              href="http://localhost:8000/download-report"
              download
              className="px-6 py-3 bg-green-600 text-white rounded-xl shadow-sm hover:bg-green-700 font-medium flex items-center gap-2 transition-all"
            >
              <FiDownload size={18} /> Download Excel Report
            </a>
            <button 
                onClick={() => navigate('/ili-comparison')}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-all shadow-lg flex items-center gap-2 animate-bounce-short"
              >
                <FiFileText size={18} />
                View Full Dashboard
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
