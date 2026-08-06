/**
 * Development-only harness for the Feature rules and Tolerances wizard steps.
 *
 * Both steps only open on a wizard config produced by a completed intake, GW
 * match and sectioning pass, which makes iterating on their layout expensive.
 * This page feeds them a config shaped exactly like the wizard produces so the
 * table, the projection panel and the dark theme can be worked on without a
 * backend or a session.
 *
 * Mounted behind `import.meta.env.DEV`, alongside `/ffs-preview`.
 */

import { useState } from 'react';

import StepFeatureRules from '../wizard/StepFeatureRules.tsx';
import StepScenarioFilter from '../wizard/StepScenarioFilter.tsx';
import { Segmented } from '../components/ds';
import '../styles/alignment-review.css';

/** Counts taken from the HU_CPA 2024/2026 pair used throughout the screenshots. */
const CONFIG = {
  summaryData: {
    newRun: { name: 'HU_CPA_2026.xlsx', year: '2026', anomalies: 10860, welds: 570, valves: 7, tees: 0 },
    oldRun: { name: 'HU_CPA_2024.xlsx', year: '2024', anomalies: 1305, welds: 266, valves: 6, tees: 0 },
    masterRun: { name: 'HU_CPA_2026.xlsx', year: '2026', anomalies: 10860 },
    historicalRuns: [],
  },
  hiddenFeatures: ['bend'],
};

type StepId = 'features' | 'tolerances';

export default function TolerancesPreviewPage() {
  const [step, setStep] = useState<StepId>('tolerances');
  const [config, setConfig] = useState<any>(CONFIG);
  const [emitted, setEmitted] = useState<any>(null);

  const handleNext = (data: any) => {
    setEmitted(data);
    setConfig((current: any) => ({ ...current, ...data }));
  };

  return (
    <div className="alignment-workspace">
      <div className="alignment-shell flex flex-col gap-5">
        <div className="ds-row" style={{ justifyContent: 'space-between' }}>
          <Segmented<StepId>
            ariaLabel="Preview step"
            value={step}
            onChange={setStep}
            options={[
              { value: 'features', label: 'Feature rules' },
              { value: 'tolerances', label: 'Tolerances' },
            ]}
          />
          {emitted && (
            <code className="ds-readout" style={{ maxWidth: '38rem', overflow: 'hidden' }}>
              {JSON.stringify(emitted)}
            </code>
          )}
        </div>

        <div className="alignment-content w-full">
          {step === 'features' && (
            <StepFeatureRules onNext={handleNext} onBack={() => {}} config={config} />
          )}
          {step === 'tolerances' && (
            <StepScenarioFilter onNext={handleNext} onBack={() => {}} config={config} />
          )}
        </div>
      </div>
    </div>
  );
}
