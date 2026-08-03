import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { FiRotateCcw, FiSliders } from 'react-icons/fi';
import { formatLifeProjection, lifeProjectionStatusLabel } from '../../lib/ffs/lifeProjection.ts';
import {
  evaluateFfsScenario,
  scenarioInputsForPreset,
  type FfsScenarioInputs,
  type FfsScenarioPreset,
} from '../../lib/ffs/scenarioLab.ts';
import type { FfsConfig, FfsResult, FfsScreeningConfig } from '../../lib/ffs/types.ts';
import { SeverityBadge, formatErf } from './FfsPrimitives.tsx';

type ScenarioSelection = FfsScenarioPreset | 'custom';

function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function axisStep(maximum: number): number {
  if (maximum <= 5) return 1;
  if (maximum <= 15) return 2.5;
  if (maximum <= 40) return 5;
  if (maximum <= 100) return 10;
  return 25;
}

function axisMaximum(values: number[]): number {
  const maximum = Math.max(1, ...values.map(finiteOrZero));
  const step = axisStep(maximum);
  return Math.ceil((maximum * 1.08) / step) * step;
}

function positionOnAxis(value: number, maximum: number): number {
  if (!Number.isFinite(value) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (value / maximum) * 100));
}

function pressureValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

export function PressureComparisonRail({
  label,
  requiredPressureMpa,
  safePressureMpa,
  failurePressureMpa,
}: {
  label: string;
  requiredPressureMpa: number;
  safePressureMpa: number;
  failurePressureMpa: number;
}) {
  const maximum = axisMaximum([requiredPressureMpa, safePressureMpa, failurePressureMpa]);
  const requiredPosition = positionOnAxis(requiredPressureMpa, maximum);
  const safePosition = positionOnAxis(safePressureMpa, maximum);
  const failurePosition = positionOnAxis(failurePressureMpa, maximum);
  const ticks = Array.from({ length: 5 }, (_, index) => (maximum * index) / 4);
  const margin = safePressureMpa - requiredPressureMpa;
  const trackStyle = {
    '--ffs-safe-position': `${safePosition}%`,
    '--ffs-failure-position': `${failurePosition}%`,
  } as CSSProperties;

  return (
    <figure className="ffs-pressure-rail" aria-label={`${label} pressure comparison in MPa`}>
      <figcaption className="ffs-pressure-rail__heading">
        <span>{label}</span>
        <strong className={margin >= 0 ? 'is-positive' : 'is-negative'}>
          {margin >= 0 ? '+' : ''}{margin.toFixed(2)} MPa to safe pressure
        </strong>
      </figcaption>
      <div className="ffs-pressure-rail__plot">
        <div className="ffs-pressure-rail__ticks" aria-hidden="true">
          {ticks.map((tick) => <span key={tick}>{Number.isInteger(tick) ? tick : tick.toFixed(1)}</span>)}
        </div>
        <div className="ffs-pressure-rail__track" style={trackStyle} aria-hidden="true">
          <i className="ffs-pressure-rail__marker ffs-pressure-rail__marker--required" style={{ left: `${requiredPosition}%` }} />
          <i className="ffs-pressure-rail__marker ffs-pressure-rail__marker--safe" style={{ left: `${safePosition}%` }} />
          <i className="ffs-pressure-rail__marker ffs-pressure-rail__marker--failure" style={{ left: `${failurePosition}%` }} />
        </div>
      </div>
      <div className="ffs-pressure-rail__legend">
        <div><i className="is-required" /><span>Required</span><strong>{pressureValue(requiredPressureMpa)} MPa</strong></div>
        <div><i className="is-safe" /><span>Safe</span><strong>{pressureValue(safePressureMpa)} MPa</strong></div>
        <div><i className="is-failure" /><span>Failure</span><strong>{pressureValue(failurePressureMpa)} MPa</strong></div>
      </div>
    </figure>
  );
}

function ScenarioControl({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="ffs-scenario__control">
      <div className="ffs-scenario__control-heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{value.toFixed(step < 0.1 ? 2 : 1)} {unit}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <p>{hint}</p>
    </div>
  );
}

export default function FfsScenarioLab({
  featureKey,
  nominal,
  config,
  screening,
}: {
  featureKey: string;
  nominal: FfsResult;
  config: FfsConfig;
  screening: FfsScreeningConfig;
}) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<ScenarioSelection>('as-reported');
  const [inputs, setInputs] = useState<FfsScenarioInputs>(() => (
    scenarioInputsForPreset('as-reported', nominal, screening)
  ));

  useEffect(() => {
    setSelection('as-reported');
    setInputs(scenarioInputsForPreset('as-reported', nominal, screening));
  }, [featureKey, nominal, screening]);

  const evaluationState = useMemo(() => {
    try {
      return { value: evaluateFfsScenario(nominal, config, screening, inputs), error: null };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : 'The draft assumptions are not usable.',
      };
    }
  }, [config, inputs, nominal, screening]);

  const pressureMaximum = axisMaximum([nominal.p0, nominal.safePressure, nominal.Pf]);
  const assessedGrowthRate = scenarioInputsForPreset('forecast', nominal, screening).depthGrowthRateMmPerYear;
  const growthMaximum = Math.max(1, Math.ceil(assessedGrowthRate * 4 * 10) / 10);
  const panelId = `ffs-scenario-${featureKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const choosePreset = (preset: FfsScenarioPreset) => {
    setSelection(preset);
    setInputs(scenarioInputsForPreset(preset, nominal, screening));
  };
  const updateInputs = (patch: Partial<FfsScenarioInputs>) => {
    setSelection('custom');
    setInputs((current) => ({ ...current, ...patch }));
  };

  const evaluation = evaluationState.value;

  return (
    <section className="ffs-detail__section ffs-scenario">
      <div className="ffs-scenario__section-heading">
        <div>
          <h3 className="ffs-detail__section-title">Pressure comparison</h3>
          <p>Required pressure is plotted against the calculated B31G capacity.</p>
        </div>
        <button
          type="button"
          className="ffs-scenario__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <FiSliders aria-hidden="true" />
          {open ? 'Close what-if' : 'Open what-if'}
        </button>
      </div>

      <PressureComparisonRail
        label="Official assessment"
        requiredPressureMpa={nominal.p0}
        safePressureMpa={nominal.safePressure}
        failurePressureMpa={nominal.Pf}
      />

      {open && (
        <div id={panelId} className="ffs-scenario__panel">
          <div className="ffs-scenario__notice" role="note">
            <strong>Draft only.</strong> Controls recalculate a separate scenario through the same B31G kernel.
            Imported ILI values and the official assessment above remain unchanged.
          </div>

          <div className="ffs-scenario__toolbar">
            <div className="ffs-scenario__presets" aria-label="Scenario presets">
              {([
                ['as-reported', 'As reported'],
                ['conservative', 'Conservative'],
                ['forecast', `${screening.forecastYears}-year forecast`],
              ] as const).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={selection === preset}
                  onClick={() => choosePreset(preset)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="ffs-scenario__reset" onClick={() => choosePreset('as-reported')}>
              <FiRotateCcw aria-hidden="true" /> Reset
            </button>
          </div>

          <div className="ffs-scenario__controls">
            <ScenarioControl
              id={`${panelId}-pressure`}
              label="Required pressure"
              value={inputs.requiredPressureMpa}
              min={0.1}
              max={pressureMaximum}
              step={0.1}
              unit="MPa"
              hint="ERF basis only; Pf and safe pressure remain capacity outputs."
              onChange={(requiredPressureMpa) => updateInputs({ requiredPressureMpa })}
            />
            <ScenarioControl
              id={`${panelId}-growth`}
              label="Depth growth rate"
              value={inputs.depthGrowthRateMmPerYear}
              min={0}
              max={growthMaximum}
              step={0.01}
              unit="mm/y"
              hint="Draft assumption; source growth evidence is not overwritten."
              onChange={(depthGrowthRateMmPerYear) => updateInputs({ depthGrowthRateMmPerYear })}
            />
            <ScenarioControl
              id={`${panelId}-years`}
              label="Projection point"
              value={inputs.forecastYears}
              min={0}
              max={nominal.analysisHorizonYears}
              step={0.5}
              unit="years"
              hint={`Bounded to the configured ${nominal.analysisHorizonYears}-year analysis horizon.`}
              onChange={(forecastYears) => updateInputs({ forecastYears })}
            />
          </div>

          <label className="ffs-scenario__tolerance">
            <input
              type="checkbox"
              checked={inputs.applyConfiguredTolerance}
              onChange={(event) => updateInputs({ applyConfiguredTolerance: event.currentTarget.checked })}
            />
            <span>
              <strong>Apply configured ILI tolerance</strong>
              <small>+{screening.depthTolerancePct}% WT depth and +{2 * screening.lengthToleranceMm} mm axial length</small>
            </span>
          </label>

          <p className="ffs-scenario__fixed-assumption">
            Axial growth remains {inputs.lengthGrowthRateMmPerYear.toFixed(3)} mm/y from the assessment evidence.
          </p>

          {evaluationState.error && (
            <div className="ffs-scenario__error" role="alert">{evaluationState.error}</div>
          )}

          {evaluation && (
            <>
              <div className="ffs-scenario__result-heading">
                <div>
                  <span>Draft scenario outcome</span>
                  <strong>{selection === 'custom' ? 'Custom assumptions' : selection.replace('-', ' ')}</strong>
                </div>
                <SeverityBadge severity={evaluation.severity} />
              </div>

              <div className="ffs-scenario__result-grid">
                <div><span>Projected depth</span><strong>{evaluation.depthPct.toFixed(2)}%</strong></div>
                <div><span>Safe pressure</span><strong>{pressureValue(evaluation.safePressureMpa)} MPa</strong></div>
                <div><span>ERF</span><strong>{formatErf(evaluation.erf)}</strong></div>
                <div>
                  <span>First projected limit</span>
                  <strong>{formatLifeProjection(evaluation.limitYears, evaluation.limitStatus, evaluation.analysisHorizonYears)}</strong>
                  <small>{lifeProjectionStatusLabel(evaluation.limitStatus, evaluation.limitCriterion, evaluation.analysisHorizonYears)}</small>
                </div>
              </div>

              <PressureComparisonRail
                label={`Draft at ${inputs.forecastYears.toFixed(1)} years`}
                requiredPressureMpa={inputs.requiredPressureMpa}
                safePressureMpa={evaluation.safePressureMpa}
                failurePressureMpa={evaluation.failurePressureMpa}
              />

              {(evaluation.beyondDepthLimit || !evaluation.valid) && (
                <div className="ffs-scenario__error" role="status">
                  {evaluation.invalidReason ?? 'Projected depth is outside the supported B31G depth domain.'}
                  {' '}Treat this scenario as an escalation trigger, not an acceptable code result.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
