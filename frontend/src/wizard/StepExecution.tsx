import { useState, useEffect } from 'react';
import { FiCheckCircle, FiAlertTriangle, FiFileText, FiDownload } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

interface StepExecutionProps {
  onBack: () => void;
  config: any;
}

export default function StepExecution({ onBack, config }: StepExecutionProps) {
  const navigate = useNavigate();
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    setTerminalLines(["Connecting to Alignment Server..."]);
    
    // Convert config to query params
    const queryParams = new URLSearchParams({
      clockTol: config.clockTol || '15',
      distGwTol: config.distGwTol || '0.2',
      depthGrowthMax: config.depthGrowthMax || '25',
      ota: config.ota || '1.5'
    });

    const eventSource = new EventSource(`http://localhost:8000/stream-alignment?${queryParams.toString()}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.message) {
        setTerminalLines((prev) => [...prev, data.message]);
        
        // Pseudo progress updates based on output
        if (data.message.includes('FASE 1:')) setProgress(20);
        if (data.message.includes('FASE 2:')) setProgress(40);
        if (data.message.includes('FASE 3:')) setProgress(60);
        if (data.message.includes('FASE 4:')) setProgress(80);
        if (data.message.includes('SELESAI:')) {
          setProgress(100);
          setShowValidation(true);
        }
      }
      if (data.status === 'done') {
        setProgress(100);
        setShowValidation(true);
        eventSource.close();
      }
      if (data.error) {
        setTerminalLines((prev) => [...prev, `[ERROR] ${data.error}`]);
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      eventSource.close();
      setTerminalLines((prev) => [...prev, "[FATAL ERROR] Disconnected from server."]);
    };

    return () => {
      eventSource.close();
    };
  }, [config]);

  return (
    <div className="bg-white rounded-[24px] p-8 shadow-sm border border-gray-100 animate-fade-in flex flex-col gap-8">
      
      {/* Terminal View with MacOS-like header */}
      <div className="flex flex-col bg-[#0f172a] rounded-2xl shadow-xl overflow-hidden border border-gray-800">
        <div className="h-10 bg-[#1e293b] flex items-center px-4 border-b border-gray-700/50">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
          </div>
          <div className="mx-auto text-xs font-mono text-gray-400">alignment-server-v8.1</div>
        </div>
        <div className="min-h-[280px] max-h-[350px] p-6 overflow-y-auto font-mono text-[13px] leading-relaxed relative">
          {terminalLines.map((line, i) => {
            let textColor = 'text-green-400';
            if (line.includes('ERROR') || line.includes('anomali depth berkurang') || line.includes('clock-shift')) textColor = 'text-orange-400';
            if (line.includes('SELESAI')) textColor = 'text-blue-400 font-bold';
            if (line.startsWith('──')) textColor = 'text-gray-400';
            
            return (
              <div key={i} className={`${textColor} mb-1 opacity-0 animate-fade-in-up`} style={{ animationFillMode: 'forwards' }}>
                <span className="text-gray-600 mr-2">$</span>{line}
              </div>
            );
          })}
          {progress < 100 && (
            <div className="text-gray-500 mt-2 animate-pulse">
              <span className="text-gray-600 mr-2">$</span>_
            </div>
          )}
        </div>
        
        {/* Integrated Progress Bar inside terminal block */}
        <div className="px-6 pb-6 pt-2">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-mono text-gray-400">Execution Progress</span>
            <span className="text-xs font-mono font-bold text-blue-400">{progress}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-1.5 rounded-full transition-all duration-700 ease-out relative" style={{ width: `${progress}%` }}>
              <div className="absolute top-0 right-0 bottom-0 left-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_25%,rgba(255,255,255,0.2)_50%,transparent_50%,transparent_75%,rgba(255,255,255,0.2)_75%,rgba(255,255,255,0.2)_100%)] bg-[length:20px_20px] animate-[stripes_1s_linear_infinite]" />
            </div>
          </div>
        </div>
      </div>
      
      {/* Physics Validation Results (Shows up when progress is 100%) */}
      {showValidation && (
        <div className="animate-fade-in-up">
          <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600">
              <FiCheckCircle size={18} />
            </div>
            Post-Alignment Validation Results
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white border border-red-100 rounded-2xl p-6 shadow-[0_4px_20px_-4px_rgba(239,68,68,0.1)] relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
               <h4 className="font-bold text-red-700 flex items-center gap-2 mb-4">
                 <FiAlertTriangle className="text-red-500" /> Physics Red Flags
               </h4>
               <ul className="text-sm text-gray-600 space-y-3">
                 <li className="flex items-start gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                   <span><strong className="text-red-600">4 Anomalies</strong> show impossible depth regression (Depth NEW &lt; Depth OLD).</span>
                 </li>
                 <li className="flex items-start gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                   <span><strong className="text-red-600">3 Anomalies</strong> flagged for severe orientation shift (&gt;45° clock rotation).</span>
                 </li>
                 <li className="flex items-start gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                   <span><strong className="text-red-600">1 Anomaly</strong> changed location classification (Internal to External).</span>
                 </li>
               </ul>
            </div>
            
            <div className="bg-white border border-blue-100 rounded-2xl p-6 shadow-[0_4px_20px_-4px_rgba(59,130,246,0.1)] relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
               <h4 className="font-bold text-blue-800 flex items-center gap-2 mb-4">
                 <FiCheckCircle className="text-blue-500" /> Naive Bayes Confidence
               </h4>
               <ul className="text-sm text-gray-600 space-y-2">
                 <li className="flex justify-between items-center py-1 border-b border-gray-50">
                   <span className="text-gray-500">High Confidence (&gt;90%)</span> <span className="font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">1,150 matches</span>
                 </li>
                 <li className="flex justify-between items-center py-1 border-b border-gray-50">
                   <span className="text-gray-500">Medium Confidence (70-90%)</span> <span className="font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">103 matches</span>
                 </li>
                 <li className="flex justify-between items-center py-1">
                   <span className="text-gray-500">Low Confidence (&lt;70%)</span> <span className="font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">20 matches</span>
                 </li>
               </ul>
               <p className="text-[11px] text-blue-600/70 mt-4 italic bg-blue-50/50 p-2 rounded-lg">Low confidence matches usually indicate severe odometer drift or sensor noise around the anomaly.</p>
            </div>
          </div>
          
          <div className="flex gap-4 justify-end pt-4 border-t border-gray-100">
            <a
              href="http://localhost:8000/download-report"
              download
              className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl shadow-sm hover:bg-gray-50 hover:border-gray-300 font-bold flex items-center gap-2 transition-all"
            >
              <FiDownload size={18} className="text-gray-400" /> Download Excel Report
            </a>
            <button 
                onClick={() => navigate(`/ili-comparison?sessionId=${config.sessionId || ''}`)}
                className="bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-theme-md hover:shadow-theme-lg flex items-center gap-2"
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
