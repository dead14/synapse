import { useEffect, useMemo, useState } from 'react';
import { FiRotateCcw, FiSliders } from 'react-icons/fi';
import { analysisHorizonYears, formatLifeProjection, lifeProjectionStatusLabel } from '../../lib/ffs/lifeProjection.ts';
import { axisMaximum, pressureRailLayout } from '../../lib/ffs/pressureRail.ts';
import {
  evaluateFfsScenario,
  scenarioInputsForPreset,
  type FfsScenarioInputs,
  type FfsScenarioPreset,
} from '../../lib/ffs/scenarioLab.ts';
import type { FfsConfig, FfsResult, FfsScreeningConfig } from '../../lib/ffs/types.ts';
import { SeverityBadge, formatErf } from './FfsPrimitives.tsx';

type ScenarioSelection = FfsScenarioPreset | 'custom';

function pressureValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function tickValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
  const layout = pressureRailLayout({ requiredPressureMpa, safePressureMpa, failurePressureMpa });
  const { acceptable, marginMpa } = layout;

  return (
    <figure className="ffs-pressure-rail" aria-label={`${label} pressure comparison in MPa`}>
      <figcaption className="ffs-pressure-rail__heading">
        <span>{label}</span>
        <ul className="ffs-pressure-rail__legend">
          {layout.markers.map((marker) => (
            <li key={marker.id}>
              <i className={`is-${marker.id}`} aria-hidden="true" />
              {marker.label}
            </li>
          ))}
        </ul>
      </figcaption>

      <div className="ffs-pressure-rail__plot">
        <div className="ffs-pressure-rail__callouts">
          {layout.markers.map((marker) => (
            <i
              key={`${marker.id}-leader`}
              className="ffs-pressure-rail__leader"
              style={{ left: `${marker.positionPct}%` }}
              aria-hidden="true"
            />
          ))}
          {layout.markers.map((marker) => (
            <span
              key={marker.id}
              className={`ffs-pressure-rail__callout is-${marker.id}`}
              style={{ left: `${marker.labelPct}%` }}
            >
              <b>{marker.symbol}</b>
              {pressureValue(marker.valueMpa)}
            </span>
          ))}
        </div>

        <div className="ffs-pressure-rail__track" aria-hidden="true">
          {layout.bands.map((band) => (
            <span
              key={band.id}
              className={`ffs-pressure-rail__band is-${band.id}`}
              style={{ left: `${band.fromPct}%`, width: `${Math.max(0, band.toPct - band.fromPct)}%` }}
            />
          ))}
          {layout.markers.map((marker) => (
            <i
              key={marker.id}
              className={`ffs-pressure-rail__marker is-${marker.id}`}
              style={{ left: `${marker.positionPct}%` }}
            />
          ))}
        </div>

        <div className="ffs-pressure-rail__axis" aria-hidden="true">
          {layout.ticksMpa.map((tick) => (
            <span key={tick}>{tickValue(tick)}</span>
          ))}
          <em>MPa</em>
        </div>
      </div>

      <p className={`ffs-pressure-rail__verdict ${acceptable ? 'is-pass' : 'is-fail'}`}>
        <span>Pₛₐᶠₑ {acceptable ? '≥' : '<'} P₀</span>
        <strong>{acceptable ? 'Acceptable' : 'Not acceptable'}</strong>
        <small>
          {marginMpa >= 0 ? '+' : ''}{marginMpa.toFixed(3)} MPa margin to required pressure
        </small>
      </p>
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
        aria-describedby={`${id}-hint`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <p id={`${id}-hint`}>{hint}</p>
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

  // The bound the scenario is actually rejected against lives on the assessment
  // configuration, so the slider is drawn from the same figure rather than from
  // the horizon a stored projection happens to carry.
  const horizonYears = analysisHorizonYears(config);
  const pressureMaximum = axisMaximum([nominal.p0, nominal.safePressure, nominal.Pf]);
  const forecastPreset = scenarioInputsForPreset('forecast', nominal, screening);
  const assessedGrowthRate = forecastPreset.depthGrowthRateMmPerYear;
  const forecastWasBounded = forecastPreset.forecastYears < screening.forecastYears;
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
  const outsideDomain = Boolean(evaluation && (evaluation.beyondDepthLimit || !evaluation.valid));

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
        <div id={panelId} className="ffs-scenario__panel" role="region" aria-label="Draft what-if scenario">
          <div className="ffs-scenario__notice" role="note">
            <strong>Draft only.</strong> Controls recalculate a separate scenario through the same B31G kernel.
            Imported ILI values and the official assessment above remain unchanged.
          </div>

          <div className="ffs-scenario__toolbar">
            <div className="ffs-scenario__presets" role="group" aria-label="Scenario presets">
              {([
                ['as-reported', 'As reported'],
                ['conservative', 'Conservative'],
                ['forecast', `${forecastPreset.forecastYears}-year forecast`],
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
              max={horizonYears}
              step={0.5}
              unit="years"
              hint={`Bounded to the configured ${horizonYears}-year analysis horizon.`}
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
            {forecastWasBounded && (
              <> The configured {screening.forecastYears}-year preset is bounded to the {forecastPreset.forecastYears}-year analysis horizon.</>
            )}
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
                <SeverityBadge
                  severity={evaluation.severity}
                  label={outsideDomain ? 'Outside B31G domain' : undefined}
                />
              </div>

              {outsideDomain && (
                <div className="ffs-scenario__error" role="status">
                  {evaluation.invalidReason ?? 'Projected depth is outside the supported B31G depth domain.'}
                  {' '}The values below are indicators only and must not be treated as an acceptable code result.
                </div>
              )}

              <div className="ffs-scenario__result-grid">
                <div><span>Projected depth</span><strong>{evaluation.depthPct.toFixed(2)}%</strong></div>
                <div><span>{outsideDomain ? 'Safe-pressure indicator' : 'Safe pressure'}</span><strong>{pressureValue(evaluation.safePressureMpa)} MPa</strong></div>
                <div><span>{outsideDomain ? 'ERF indicator' : 'ERF'}</span><strong>{formatErf(evaluation.erf)}</strong></div>
                <div>
                  <span>First projected limit</span>
                  <strong>{formatLifeProjection(evaluation.limitYears, evaluation.limitStatus, evaluation.analysisHorizonYears)}</strong>
                  <small>{lifeProjectionStatusLabel(evaluation.limitStatus, evaluation.limitCriterion, evaluation.analysisHorizonYears)}</small>
                </div>
              </div>

              <PressureComparisonRail
                label={`${outsideDomain ? 'Draft indicator' : 'Draft'} at ${inputs.forecastYears.toFixed(1)} years`}
                requiredPressureMpa={inputs.requiredPressureMpa}
                safePressureMpa={evaluation.safePressureMpa}
                failurePressureMpa={evaluation.failurePressureMpa}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
