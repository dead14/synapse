import React, { useState } from 'react';
import { FiBell, FiSettings } from 'react-icons/fi';
import StepDataSummary from './wizard/StepDataSummary';
import StepScenarioFilter from './wizard/StepScenarioFilter';
import StepGwSimulator from './wizard/StepGwSimulator';
import StepAnomalyTolerances from './wizard/StepAnomalyTolerances';
import StepExecution from './wizard/StepExecution';
import StepUploadILI from './wizard/StepUploadILI';

export default function AlignmentPage() {
  const [step, setStep] = useState(0);
  const [wizardConfig, setWizardConfig] = useState<any>({});

  const handleNext = (data?: any) => {
    if (data) setWizardConfig((prev: any) => ({ ...prev, ...data }));
    setStep(s => Math.min(s + 1, 5));
  };

  const handleBack = () => {
    setStep(s => Math.max(s - 1, 0));
  };

  const stepsList = [
    { id: 0, name: 'Upload', desc: 'Validate' },
    { id: 1, name: 'Data Summary', desc: 'Overview' },
    { id: 2, name: 'Scenario Filter', desc: 'Thresholds' },
    { id: 3, name: 'GW Matching', desc: 'Simulator' },
    { id: 4, name: 'Anomaly Tolerances', desc: 'Matcher' },
    { id: 5, name: 'Execution', desc: 'Report Gen' }
  ];

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex flex-col items-center pt-8 pb-20">
      <div className="w-full max-w-[1400px] px-8 flex flex-col gap-6">
        
        {/* Alignment Progress Bar (Matches Screenshot 2) */}
        {step > 0 && (
        <div className="bg-white rounded-[24px] p-8 shadow-sm border border-gray-100 flex justify-between items-center relative overflow-hidden">
          <div className="relative z-10 w-full">
            <div className="flex justify-between items-end mb-8">
               <div>
                 <h2 className="text-2xl font-bold text-gray-800 mb-1">Alignment Progress</h2>
                 <p className="text-gray-500 text-sm">Executing multi-step sequential matching algorithm</p>
               </div>
               <div className="text-5xl font-black text-brand-500 tracking-tighter">
                  {Math.round((step / 5) * 100)}%
               </div>
            </div>

            {/* Stepper Line */}
            <div className="relative flex justify-between items-center w-full px-6 mt-4">
              <div className="absolute top-1/2 left-6 right-6 h-[1px] bg-gray-200 -z-10 -translate-y-1/2"></div>
              
              {stepsList.map((s, index) => (
                <div key={s.id} className="flex flex-col items-center gap-3">
                  <div className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    step >= index ? 'bg-brand-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-gray-300'
                  }`} />
                  <div className="text-center">
                    <p className={`text-xs font-semibold whitespace-nowrap transition-colors ${step >= index ? 'text-gray-800' : 'text-gray-500'}`}>
                      {s.name}
                    </p>
                    <p className="text-[10px] text-gray-500">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

        {/* Wizard Steps Rendering */}
        <div className="w-full mt-4">
          {step === 0 && (
            <StepUploadILI onNext={() => setStep(1)} />
          )}

          {step === 1 && <StepDataSummary onNext={handleNext} />}
          
          {step === 2 && <StepScenarioFilter onNext={handleNext} onBack={handleBack} />}

          {step === 3 && <StepGwSimulator initialOta={wizardConfig.ota || 1.0} onNext={handleNext} onBack={handleBack} />}

          {step === 4 && <StepAnomalyTolerances onNext={handleNext} onBack={handleBack} />}

          {step === 5 && <StepExecution onBack={handleBack} />}
          
        </div>
      </div>
    </div>
  );
}
