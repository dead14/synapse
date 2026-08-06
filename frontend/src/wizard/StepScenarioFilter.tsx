import { useMemo, useState } from 'react';
import {
  FiAward,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiEye,
  FiEyeOff,
  FiInfo,
  FiLock,
  FiSliders,
} from 'react-icons/fi';

import {
  ActionBar,
  Button,
  Callout,
  Panel,
  PanelBody,
  PanelHeader,
  SliderField,
  Switch,
} from '../components/ds';
import { primaryRunPair, resolveRunPairs } from '../domain/runPairs';
import {
  buildMatchingRulesConfig,
  defaultMatchingRules,
  RECOMMENDED_TOLERANCES,
  type ToleranceValues,
} from './matchingRules';

const TOGGLEABLE_FEATURES = [
  { key: 'valve', label: 'Valves' },
  { key: 'tee', label: 'Tees' },
  { key: 'bend', label: 'Bends' },
  { key: 'offtake', label: 'Offtakes' },
  { key: 'other', label: 'Other features' },
] as const;

interface StepScenarioFilterProps {
  onNext: (config: any) => void;
  onBack: () => void;
  config?: any;
}

export default function StepScenarioFilter({ onNext, onBack, config }: StepScenarioFilterProps) {
  const pairs = useMemo(() => resolveRunPairs(config?.summaryData), [config?.summaryData]);
  const primaryPair = useMemo(() => primaryRunPair(config?.summaryData), [config?.summaryData]);
  const defaults = useMemo(() => defaultMatchingRules(config), [config]);
  const storedPerPair = config?.pairToleranceConfigs;

  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const [perPairEnabled, setPerPairEnabled] = useState(
    () => Object.keys(storedPerPair || {}).length > 1,
  );
  const [shared, setShared] = useState<ToleranceValues>(defaults.shared);
  const [byPair, setByPair] = useState<Record<string, ToleranceValues>>(() => (
    Object.fromEntries(
      pairs.map((pair) => [
        pair.key,
        { ...defaults.shared, ...(storedPerPair?.[pair.key] || {}) },
      ]),
    )
  ));
  const [hiddenFeatures, setHiddenFeatures] = useState<Set<string>>(
    () => new Set(config?.hiddenFeatures ?? []),
  );

  const toggleFeature = (key: string) => {
    setHiddenFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activePair = pairs.find((pair) => pair.key === activePairKey) ?? primaryPair ?? pairs[0] ?? null;
  const current = perPairEnabled && activePair
    ? byPair[activePair.key] ?? shared
    : shared;

  const patch = (change: Partial<ToleranceValues>) => {
    if (!perPairEnabled) {
      setShared((value) => ({ ...value, ...change }));
      return;
    }
    if (!activePair) return;
    setByPair((values) => ({
      ...values,
      [activePair.key]: { ...(values[activePair.key] ?? shared), ...change },
    }));
  };

  const enablePerPair = (enabled: boolean) => {
    if (enabled) {
      setByPair(Object.fromEntries(
        pairs.map((pair) => [pair.key, { ...shared, ...(byPair[pair.key] || {}) }]),
      ));
    } else if (activePair) {
      setShared(byPair[activePair.key] ?? shared);
    }
    setPerPairEnabled(enabled);
  };

  const handleNext = () => {
    onNext(buildMatchingRulesConfig({
      shared,
      byPair,
      pairs,
      primaryPairKey: primaryPair?.key,
      perPairEnabled,
      hiddenFeatures: [...hiddenFeatures],
    }));
  };

  return (
    <Panel className="animate-fade-in">
      <PanelHeader
        icon={<FiSliders aria-hidden="true" />}
        eyebrow="Matcher rules"
        title="Scenario assessment & tolerances"
        subtitle="One verified configuration for candidate eligibility and Hungarian hard gates."
        actions={
          <Button
            variant="secondary"
            startIcon={<FiAward aria-hidden="true" />}
            onClick={() => patch(RECOMMENDED_TOLERANCES)}
          >
            Use recommended
          </Button>
        }
      />

      <PanelBody className="ds-stack ds-stack--lg">
        <div className="matching-rule-evidence">
          <article>
            <FiCheckCircle aria-hidden="true" />
            <div>
              <strong>GW and landmark rows</strong>
              <span>Used by the anchor phase and retained in the final table.</span>
            </div>
          </article>
          <article>
            <FiCheckCircle aria-hidden="true" />
            <div>
              <strong>Metal-loss anomalies</strong>
              <span>Eligible for Hungarian matching within locked GW sections.</span>
            </div>
          </article>
          <article>
            <FiCheckCircle aria-hidden="true" />
            <div>
              <strong>Invalid or outside-domain rows</strong>
              <span>Never silently dropped; emitted as Filtered OLD/NEW evidence.</span>
            </div>
          </article>
        </div>

        {pairs.length > 1 && (
          <Panel quiet>
            <PanelHeader
              plain
              eyebrow="Run pairs"
              title="Tolerance scope"
              subtitle={
                perPairEnabled
                  ? 'Select a pair to tune its engine gates.'
                  : `One verified tolerance set applies to all ${pairs.length} comparison pairs.`
              }
              actions={
                <Switch
                  checked={perPairEnabled}
                  onChange={enablePerPair}
                  label="Configure each run pair separately"
                />
              }
            />
            {perPairEnabled && (
              <PanelBody tight>
                <div className="ds-row">
                  {pairs.map((pair) => (
                    <Button
                      key={pair.key}
                      size="sm"
                      variant={pair.key === activePair?.key ? 'primary' : 'secondary'}
                      aria-pressed={pair.key === activePair?.key}
                      onClick={() => setActivePairKey(pair.key)}
                    >
                      {pair.label}
                    </Button>
                  ))}
                </div>
              </PanelBody>
            )}
          </Panel>
        )}

        <div className="scenario-split">
          <div className="scenario-split__tolerances">
            <div className="ds-grid-2">
              <Panel quiet>
                <PanelBody>
                  <SliderField
                    label="Clock tolerance"
                    value={current.clock_tolerance}
                    display={`${current.clock_tolerance}°`}
                    min={5}
                    max={45}
                    step={1}
                    onChange={(value) => patch({ clock_tolerance: value })}
                    hint="Circular hard gate. Candidate pairs outside this clock difference are rejected."
                  />
                </PanelBody>
              </Panel>

              <Panel quiet>
                <PanelBody>
                  <SliderField
                    label="US GW distance tolerance"
                    value={current.us_gw_distance_tolerance}
                    display={`± ${current.us_gw_distance_tolerance} m`}
                    min={0.05}
                    max={2}
                    step={0.05}
                    disabled={!current.use_us_gw_distance}
                    onChange={(value) => patch({ us_gw_distance_tolerance: value })}
                    hint="Hard gate against the uploaded Dist. U/S GW value."
                  >
                    <label className="ds-row matching-rule-checkbox">
                      <input
                        type="checkbox"
                        checked={current.use_us_gw_distance}
                        onChange={(event) => patch({ use_us_gw_distance: event.target.checked })}
                      />
                      <span>Use uploaded U/S GW distance</span>
                    </label>
                  </SliderField>
                </PanelBody>
              </Panel>

              <Panel quiet>
                <PanelBody>
                  <SliderField
                    label="DS GW distance tolerance"
                    value={current.ds_gw_distance_tolerance}
                    display={`± ${current.ds_gw_distance_tolerance} m`}
                    min={0.05}
                    max={2}
                    step={0.05}
                    onChange={(value) => patch({ ds_gw_distance_tolerance: value })}
                    hint="Directional hard gate downstream of each locked girth weld."
                  />
                </PanelBody>
              </Panel>

              <Panel quiet>
                <PanelBody>
                  <SliderField
                    label="Length tolerance"
                    value={current.length_tolerance}
                    display={`± ${current.length_tolerance} mm`}
                    min={5}
                    max={200}
                    step={5}
                    onChange={(value) => patch({ length_tolerance: value })}
                    hint="Candidate pairs exceeding this length difference are rejected."
                  />
                </PanelBody>
              </Panel>
            </div>
          </div>

          <Panel quiet className="scenario-split__visibility">
            <PanelHeader plain eyebrow="Report visibility" title="Feature types" />
            <PanelBody className="ds-stack">
              <label className="feature-visibility-row feature-visibility-row--locked">
                <FiLock aria-hidden="true" />
                <span>Metal loss</span>
                <FiEye aria-hidden="true" className="feature-visibility-icon--on" />
              </label>
              <label className="feature-visibility-row feature-visibility-row--locked">
                <FiLock aria-hidden="true" />
                <span>Welds</span>
                <FiEye aria-hidden="true" className="feature-visibility-icon--on" />
              </label>
              {TOGGLEABLE_FEATURES.map(({ key, label }) => (
                <label key={key} className="feature-visibility-row">
                  <input
                    type="checkbox"
                    checked={!hiddenFeatures.has(key)}
                    onChange={() => toggleFeature(key)}
                  />
                  <span>{label}</span>
                  {hiddenFeatures.has(key)
                    ? <FiEyeOff aria-hidden="true" className="feature-visibility-icon--off" />
                    : <FiEye aria-hidden="true" className="feature-visibility-icon--on" />}
                </label>
              ))}
            </PanelBody>
          </Panel>
        </div>

        <Callout tone="warning" icon={<FiInfo aria-hidden="true" />}>
          Depth is post-match physics evidence, not a pairing shortcut. A lower NEW depth is flagged
          for review after alignment and remains visible in the report.
        </Callout>

        <ActionBar
          back={
            <Button variant="ghost" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={onBack}>
              Sectioning
            </Button>
          }
          next={
            <Button endIcon={<FiChevronRight aria-hidden="true" />} onClick={handleNext}>
              Execute alignment
            </Button>
          }
        />
      </PanelBody>
    </Panel>
  );
}
