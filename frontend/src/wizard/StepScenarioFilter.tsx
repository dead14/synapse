import { useState } from 'react';
import { FiFilter, FiSettings, FiChevronRight, FiChevronLeft, FiEye, FiEyeOff, FiInfo } from 'react-icons/fi';

import { ActionBar, Button, Callout, Panel, PanelBody, PanelHeader, SliderField } from '../components/ds';

interface StepScenarioFilterProps {
  onNext: (config: any) => void;
  onBack: () => void;
}

const FEATURE_LABELS: Record<string, string> = {
  offtake: 'Offtake',
  tee: 'Tee',
  bend: 'Bend',
  support: 'Support',
  marker: 'Marker',
};

export default function StepScenarioFilter({ onNext, onBack, config: _config }: StepScenarioFilterProps & { config?: any }) {
  const [distThresh, setDistThresh] = useState(0.3);

  const [hiddenFeatures, setHiddenFeatures] = useState({
    offtake: true,
    tee: true,
    bend: false,
    support: true,
    marker: false,
  });

  const toggleFeature = (key: keyof typeof hiddenFeatures) => {
    setHiddenFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Panel className="animate-fade-in">
      <PanelHeader
        icon={<FiSettings aria-hidden="true" />}
        eyebrow="Ruleset"
        title="Scenario assessment"
        subtitle="Configure matching thresholds and filter out non-essential data."
      />

      <PanelBody>
        <div className="ds-grid-2">
          <div className="ds-stack">
            <p className="ds-eyebrow">Matching parameters</p>
            <Panel quiet>
              <PanelBody>
                <SliderField
                  label="Distance matching threshold"
                  value={distThresh}
                  display={`${distThresh.toFixed(1)} m`}
                  min={0.1}
                  max={2.0}
                  step={0.1}
                  onChange={setDistThresh}
                />
                <Callout tone="warning" icon={<FiInfo aria-hidden="true" />} className="mt-4">
                  Depth does not filter candidates. It is checked after Hungarian matching to flag
                  depth decreases that contradict expected corrosion growth.
                </Callout>
              </PanelBody>
            </Panel>
          </div>

          <div className="ds-stack">
            <p className="ds-eyebrow">Data cleansing — hide features</p>
            <Panel quiet>
              <div className="ds-table-wrap" style={{ border: 0 }}>
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Feature type</th>
                      <th style={{ textAlign: 'right' }}>Visibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(hiddenFeatures).map(([key, isHidden]) => (
                      <tr key={key}>
                        <th scope="row">{FEATURE_LABELS[key] ?? key}</th>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            size="xs"
                            variant={isHidden ? 'danger' : 'secondary'}
                            startIcon={isHidden ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
                            aria-pressed={isHidden}
                            onClick={() => toggleFeature(key as keyof typeof hiddenFeatures)}
                          >
                            {isHidden ? 'Hidden' : 'Visible'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Callout icon={<FiFilter aria-hidden="true" />}>
              Hiding non-essential landmark features lets the algorithm focus on primary anchors
              (valves, welds, tees), which raises alignment accuracy and reduces false positives.
            </Callout>
          </div>
        </div>

        <ActionBar
          back={
            <Button variant="ghost" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={onBack}>
              Back
            </Button>
          }
          next={
            <Button endIcon={<FiChevronRight aria-hidden="true" />} onClick={() => onNext({ distThresh, hiddenFeatures })}>
              Next
            </Button>
          }
        />
      </PanelBody>
    </Panel>
  );
}
