import { useMemo, useState } from 'react';
import { FiSliders, FiChevronRight, FiChevronLeft, FiAward, FiInfo } from 'react-icons/fi';
import { primaryRunPair, resolveRunPairs } from '../domain/runPairs';

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

interface StepAnomalyTolerancesProps {
  onNext: (config: any) => void;
  onBack: () => void;
  config?: any;
}

type ToleranceValues = {
  clock_tolerance: number;
  us_gw_distance_tolerance: number;
  ds_gw_distance_tolerance: number;
  use_us_gw_distance: boolean;
  length_tolerance: number;
};

const RECOMMENDED: ToleranceValues = {
  clock_tolerance: 15,
  us_gw_distance_tolerance: 0.2,
  ds_gw_distance_tolerance: 0.2,
  use_us_gw_distance: true,
  length_tolerance: 50,
};

function toleranceValues(source: any, fallbackDistThresh: unknown): ToleranceValues {
  return {
    clock_tolerance: source?.clock_tolerance ?? RECOMMENDED.clock_tolerance,
    us_gw_distance_tolerance: source?.us_gw_distance_tolerance ?? fallbackDistThresh ?? RECOMMENDED.us_gw_distance_tolerance,
    ds_gw_distance_tolerance: source?.ds_gw_distance_tolerance ?? fallbackDistThresh ?? RECOMMENDED.ds_gw_distance_tolerance,
    use_us_gw_distance: source?.use_us_gw_distance !== false,
    length_tolerance: source?.length_tolerance ?? RECOMMENDED.length_tolerance,
  } as ToleranceValues;
}

export default function StepAnomalyTolerances({ onNext, onBack, config }: StepAnomalyTolerancesProps) {
  const pairs = useMemo(() => resolveRunPairs(config?.summaryData), [config?.summaryData]);
  const primaryPair = useMemo(() => primaryRunPair(config?.summaryData), [config?.summaryData]);
  const hasMultiplePairs = pairs.length > 1;

  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const activePair = pairs.find((pair) => pair.key === activePairKey) ?? primaryPair ?? pairs[0] ?? null;

  // Most operators want one setting for the whole session, so per-pair editing
  // stays off until it is needed — otherwise a 5-run chain would demand five
  // identical set-ups before the wizard could continue.
  const storedPerPair = config?.pairToleranceConfigs;
  const [perPairEnabled, setPerPairEnabled] = useState(
    () => Object.keys(storedPerPair || {}).length > 1,
  );

  const [byPair, setByPair] = useState<Record<string, ToleranceValues>>(() => {
    const shared = toleranceValues(config?.ToleranceConfig, config?.scenario?.distThresh);
    return Object.fromEntries(
      resolveRunPairs(config?.summaryData).map((pair) => [
        pair.key,
        toleranceValues(storedPerPair?.[pair.key] ?? config?.ToleranceConfig, config?.scenario?.distThresh) ?? shared,
      ]),
    );
  });

  const activeKey = activePair?.key ?? '';
  const current = byPair[activeKey] ?? toleranceValues(config?.ToleranceConfig, config?.scenario?.distThresh);

  /** Write a field to the active pair, or to every pair while sharing is on. */
  const patch = (change: Partial<ToleranceValues>) => {
    setByPair((currentMap) => {
      if (!perPairEnabled) {
        return Object.fromEntries(
          Object.entries(currentMap).map(([key, value]) => [key, { ...value, ...change }]),
        );
      }
      return { ...currentMap, [activeKey]: { ...(currentMap[activeKey] ?? current), ...change } };
    });
  };

  const clockTol = current.clock_tolerance;
  const usGwTol = current.us_gw_distance_tolerance;
  const dsGwTol = current.ds_gw_distance_tolerance;
  const useUsGwDistance = current.use_us_gw_distance;
  const lengthTol = current.length_tolerance;

  const setClockTol = (value: number) => patch({ clock_tolerance: value });
  const setUsGwTol = (value: number) => patch({ us_gw_distance_tolerance: value });
  const setDsGwTol = (value: number) => patch({ ds_gw_distance_tolerance: value });
  const setUseUsGwDistance = (value: boolean) => patch({ use_us_gw_distance: value });
  const setLengthTol = (value: number) => patch({ length_tolerance: value });

  const applyRecommended = () => patch({ ...RECOMMENDED });

  const handleNext = () => {
    const primaryValues = (primaryPair && byPair[primaryPair.key]) || current;
    onNext({
      // The unscoped field still describes the primary pair, so the engines and
      // any session saved by an older client keep resolving one tolerance set.
      ToleranceConfig: primaryValues,
      pairToleranceConfigs: pairs.length > 0
        ? Object.fromEntries(pairs.map((pair) => [pair.key, byPair[pair.key] ?? current]))
        : undefined,
    });
  };

  return (
    <Panel className="animate-fade-in">
      <PanelHeader
        icon={<FiSliders aria-hidden="true" />}
        eyebrow="Matcher tuning"
        title="Anomaly matching tolerances"
        subtitle="Configure parameters for the Hungarian anomaly matcher."
        actions={
          <Button variant="secondary" startIcon={<FiAward aria-hidden="true" />} onClick={applyRecommended}>
            Use recommended
          </Button>
        }
      />

      <PanelBody className="ds-stack ds-stack--lg">
        <Callout
          tone="info"
          icon={<FiAward aria-hidden="true" />}
          title="Industry standard recommendations"
        >
          Applying these defaults yields the highest confidence for standard MFL tool comparisons.
        </Callout>

        {/* A 14-year interval and a 2-year interval rarely deserve the same
            tolerances, but demanding a separate set-up per pair by default would
            be busywork on a chain of five runs. */}
        {hasMultiplePairs && (
          <Panel quiet>
            <PanelHeader
              plain
              eyebrow="Run pairs"
              title="Per-run-pair tolerances"
              subtitle={
                perPairEnabled
                  ? 'Each pair uses its own tolerances. Select a pair below to configure it.'
                  : `One tolerance set applies to all ${pairs.length} pairs. Enable this when the year spans differ widely.`
              }
              actions={
                <Switch
                  checked={perPairEnabled}
                  onChange={setPerPairEnabled}
                  label="Configure separate tolerances for each run pair"
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

        <div className="ds-grid-2">
          <Panel quiet>
            <PanelBody>
              <SliderField
                label="Clock tolerance"
                value={clockTol}
                display={`${clockTol}°`}
                min={5}
                max={45}
                step={1}
                onChange={setClockTol}
                hint="Circular hard gate: candidates are rejected when the O'Clock difference exceeds this value. Empty clock values are not rejected automatically."
              />
            </PanelBody>
          </Panel>

          <Panel quiet>
            <PanelBody>
              <SliderField
                label="US GW distance tolerance"
                value={usGwTol}
                display={`± ${usGwTol} m`}
                min={0.05}
                max={2.0}
                step={0.05}
                disabled={!useUsGwDistance}
                onChange={setUsGwTol}
                hint={
                  useUsGwDistance
                    ? 'Only enable this when Dist. U/S GW values are available and trustworthy.'
                    : 'Off: Dist. U/S GW values are ignored; the U/S and D/S position limits still apply.'
                }
              >
                <label className="ds-row" style={{ gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useUsGwDistance}
                    onChange={(event) => setUseUsGwDistance(event.target.checked)}
                  />
                  <span style={{ fontSize: 'var(--ds-t-xs)', color: 'var(--ds-ink-soft)', fontWeight: 600 }}>
                    Use Dist. U/S GW for matching
                  </span>
                </label>
              </SliderField>
            </PanelBody>
          </Panel>

          <Panel quiet>
            <PanelBody>
              <SliderField
                label="DS GW distance tolerance"
                value={dsGwTol}
                display={`± ${dsGwTol} m`}
                min={0.05}
                max={2.0}
                step={0.05}
                onChange={setDsGwTol}
                hint="Applied downstream of each girth-weld anchor."
              />
            </PanelBody>
          </Panel>

          <Panel quiet>
            <PanelBody>
              <SliderField
                label="Length tolerance"
                value={lengthTol}
                display={`± ${lengthTol} mm`}
                min={5}
                max={200}
                step={5}
                onChange={setLengthTol}
                hint="Hard gate: candidates are rejected when the length difference exceeds this value."
              />
            </PanelBody>
          </Panel>
        </div>

        <Callout tone="warning" icon={<FiInfo aria-hidden="true" />}>
          Depth is not used to select pairs. After Hungarian matching completes, NEW depths smaller
          than OLD are flagged as a physics validation for review.
        </Callout>

        <ActionBar
          back={
            <Button variant="ghost" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={onBack}>
              Simulator settings
            </Button>
          }
          next={
            <Button endIcon={<FiChevronRight aria-hidden="true" />} onClick={handleNext}>
              Execute Hungarian matcher
            </Button>
          }
        />
      </PanelBody>
    </Panel>
  );
}
