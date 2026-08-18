import { useMemo, useState } from 'react';
import {
  FiAlertTriangle,
  FiArrowDown,
  FiArrowUp,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiGitCommit,
  FiFileText,
  FiGrid,
  FiLayers,
  FiMaximize2,
  FiRotateCcw,
  FiSettings,
  FiShield,
  FiSliders,
  FiUsers,
} from 'react-icons/fi';
import type { ReactNode } from 'react';

import {
  ActionBar,
  Badge,
  Button,
  Callout,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  Switch,
} from '../components/ds';
import { primaryRunPair, resolveRunPairs } from '../domain/runPairs';
import {
  ANOMALY_MATCHERS,
  buildMatchingRulesConfig,
  CLUSTER_ALIGNMENT_MODES,
  defaultMatchingRules,
  US_GW_DISTANCE_SOURCES,
  WALL_THICKNESS_SOURCES,
  type AnomalyMatcher,
  type ClusterAlignment,
  type ToleranceValues,
  type UsGwDistanceSource,
  type WallThicknessSource,
} from './matchingRules';
import {
  buildProjectionColumns,
  DEFAULT_ASSUMPTIONS,
  formatHours,
  formatSignedPercent,
  formatSignedPoints,
  formatTolerance,
  matchProfile,
  percentDelta,
  projectionInputFrom,
  sameTolerances,
  TOLERANCE_PROFILES,
  TOLERANCE_SPECS,
  type ProjectionAssumptions,
  type ToleranceKey,
  type ToleranceSpec,
} from './toleranceModel';

interface StepScenarioFilterProps {
  onNext: (config: any) => void;
  onBack: () => void;
  config?: any;
}

const ROW_ICONS: Record<ToleranceKey, ReactNode> = {
  clock_tolerance: <FiClock aria-hidden="true" />,
  us_gw_distance_tolerance: <FiArrowUp aria-hidden="true" />,
  ds_gw_distance_tolerance: <FiArrowDown aria-hidden="true" />,
  gw_offset_tolerance: <FiGitCommit aria-hidden="true" />,
  length_tolerance: <FiMaximize2 aria-hidden="true" />,
};

const IMPACT_COPY = { low: 'Low impact', medium: 'Medium impact' } as const;

function ToleranceRow({
  spec,
  value,
  disabled,
  onChange,
  children,
}: {
  spec: ToleranceSpec;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  children?: ReactNode;
}) {
  const inputId = `tol-${spec.key}`;
  const display = `${formatTolerance(spec, value)}${spec.unit === 'deg' ? '°' : ''}`;

  return (
    <div className={`tol-row${disabled ? ' tol-row--disabled' : ''}`}>
      <div className="tol-row__identity">
        <span className="tol-row__icon">{ROW_ICONS[spec.key]}</span>
        <div className="tol-row__copy">
          <label className="tol-row__label" htmlFor={inputId}>{spec.label}</label>
          <p className="tol-row__desc">{spec.description}</p>
          {children}
        </div>
      </div>

      <div className="tol-row__range">
        <div className="tol-range__scale">
          <span>{formatTolerance(spec, spec.min)}{spec.unit === 'deg' ? '°' : ''}</span>
          <span className="tol-range__value">{display}</span>
          <span>{formatTolerance(spec, spec.max)}{spec.unit === 'deg' ? '°' : ''}</span>
        </div>
        <div className="tol-range__slider">
          <span className="tol-range__track" aria-hidden="true" />
          <input
            id={inputId}
            type="range"
            className="ds-range tol-range__input"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={value}
            disabled={disabled}
            aria-describedby={`${inputId}-guidance`}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>
        <div className="tol-range__marks">
          <span>Strict</span>
          <span>Permissive</span>
        </div>
      </div>

      <div className="tol-row__current">
        <strong>{display}</strong>
        <small>{spec.unit}</small>
      </div>

      <div className="tol-row__impact" id={`${inputId}-guidance`}>
        <span className={`tol-impact tol-impact--${spec.impact}`}>
          <i aria-hidden="true" />
          {IMPACT_COPY[spec.impact]}
        </span>
        <p>{spec.guidance}</p>
      </div>
    </div>
  );
}

function MetricRow({
  icon,
  label,
  columns,
}: {
  icon: ReactNode;
  label: string;
  columns: Array<{ id: string; value: string; delta: string | null; tone: 'up' | 'down' | null }>;
}) {
  return (
    <tr>
      <th scope="row">
        <span className="tol-metric__icon">{icon}</span>
        {label}
      </th>
      {columns.map((column) => (
        <td key={column.id} className={column.id === 'current' ? 'is-current' : undefined}>
          <strong>{column.value}</strong>
          {column.delta ? (
            <small className={column.tone ? `tol-delta tol-delta--${column.tone}` : 'tol-delta'}>
              {column.delta}
            </small>
          ) : null}
        </td>
      ))}
    </tr>
  );
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
  const [assumptions, setAssumptions] = useState<ProjectionAssumptions>(DEFAULT_ASSUMPTIONS);
  const [showAssumptions, setShowAssumptions] = useState(false);

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

  // Partial: a named profile sets the gates and deliberately leaves the
  // evidence-source choices it does not own alone.
  const applyValues = (values: Partial<ToleranceValues>) => patch(values);

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
    }));
  };

  const activeProfile = matchProfile(current);
  const isDirty = !sameTolerances(current, defaults.shared);
  // The Bayesian matcher has no distance windows, so every numeric gate below —
  // and the projection built from them — describes a matcher that is not going
  // to run. They are disabled rather than hidden: the values stay saved, and
  // switching back restores exactly the set that was there before.
  const gatesApply = current.anomaly_matcher === 'hungarian';

  const projectionInput = useMemo(() => projectionInputFrom(config?.summaryData), [config?.summaryData]);
  const columns = useMemo(
    () => (projectionInput ? buildProjectionColumns(current, projectionInput, assumptions) : null),
    [current, projectionInput, assumptions],
  );
  const baseline = columns?.find((column) => column.id === 'current')?.projection;

  return (
    <div className="ds-stack ds-stack--lg animate-fade-in">
      {/* Active profile strip -------------------------------------------- */}
      <Panel className="tol-profile">
        <div className="tol-profile__inner">
          <div className="tol-profile__identity">
            <span className="ds-panel__icon"><FiSliders aria-hidden="true" /></span>
            <div>
              <strong>Active matching profile</strong>
              <p>Review and adjust tolerances. Changes affect candidate matches and review workload.</p>
            </div>
          </div>

          <dl className="tol-profile__summary">
            {TOLERANCE_SPECS.map((spec) => (
              <div key={spec.key}>
                <dt>{spec.label}</dt>
                <dd>
                  {formatTolerance(spec, current[spec.key])}
                  {spec.unit === 'deg' ? '°' : ` ${spec.unit}`}
                </dd>
              </div>
            ))}
          </dl>

          <div className="tol-profile__controls">
            <Select
              small
              aria-label="Tolerance profile"
              value={activeProfile?.id ?? 'custom'}
              onChange={(event) => {
                const profile = TOLERANCE_PROFILES.find((item) => item.id === event.target.value);
                if (profile) applyValues(profile.values);
              }}
            >
              {!activeProfile && <option value="custom">Custom</option>}
              {TOLERANCE_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label}</option>
              ))}
            </Select>
            {isDirty && <Badge tone="warning" pill>Unsaved changes</Badge>}
          </div>
        </div>
      </Panel>

      {pairs.length > 1 && (
        <Panel quiet>
          <PanelHeader
            plain
            eyebrow="Run pairs"
            title="Tolerance scope"
            subtitle={
              perPairEnabled
                ? 'Select a pair to tune its engine gates.'
                : `One tolerance set applies to all ${pairs.length} comparison pairs.`
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

      {/* Anomaly matcher --------------------------------------------------- */}
      <Panel>
        <PanelHeader
          plain
          eyebrow="Phase 2"
          title="Anomaly matcher"
          subtitle="How metal loss is paired once the girth welds are locked. The weld phase itself is unaffected."
        />
        <PanelBody className="ds-stack">
          <div className="ds-row">
            {ANOMALY_MATCHERS.map((matcher) => (
              <Button
                key={matcher.id}
                size="sm"
                variant={current.anomaly_matcher === matcher.id ? 'primary' : 'secondary'}
                aria-pressed={current.anomaly_matcher === matcher.id}
                onClick={() => patch({ anomaly_matcher: matcher.id as AnomalyMatcher })}
              >
                {matcher.label}
              </Button>
            ))}
          </div>
          <p className="tol-row__desc">
            {ANOMALY_MATCHERS.find((matcher) => matcher.id === current.anomaly_matcher)?.hint}
          </p>
          {!gatesApply && (
            <Callout tone="info" icon={<FiShield aria-hidden="true" />}>
              Bayesian drift matching uses no distance window. It measures the displacement this
              section actually has, estimates its own noise from the data, and accepts a pair only
              when the evidence favours “same defect” over coincidence — reporting a posterior
              probability and a per-channel calculation for every pair it accepts. The tolerances
              below are kept but not applied.
            </Callout>
          )}
        </PanelBody>
      </Panel>

      {/* Weld-relative distance source ------------------------------------- */}
      <Panel>
        <PanelHeader
          plain
          eyebrow="Evidence"
          title="U/S girth weld distance"
          subtitle="The strongest identity evidence in the record, and the one a pipetally most often omits."
        />
        <PanelBody className="ds-stack">
          <Select
            small
            aria-label="Source of the upstream girth weld distance"
            value={current.us_gw_distance_source}
            onChange={(event) => patch({
              us_gw_distance_source: event.target.value as UsGwDistanceSource,
            })}
          >
            {US_GW_DISTANCE_SOURCES.map((source) => (
              <option key={source.id} value={source.id}>{source.label}</option>
            ))}
          </Select>
          <p className="tol-row__desc">
            {US_GW_DISTANCE_SOURCES.find(
              (source) => source.id === current.us_gw_distance_source,
            )?.hint}
          </p>
          {current.us_gw_distance_source !== 'uploaded' && current.us_gw_distance_source !== 'off' && (
            <Callout tone="info" icon={<FiGitCommit aria-hidden="true" />}>
              A derived distance is the feature’s own odometer minus the odometer of the last girth
              weld before it, measured in the run’s native chainage. Derivation is applied to both
              runs together or to neither: a vendor measures to the weld centreline and this
              measures to the reported weld position, so mixing the two would feed a fixed bias into
              the comparison. Every result row records which source it used.
            </Callout>
          )}
        </PanelBody>
      </Panel>

      {/* Wall thickness source --------------------------------------------- */}
      <Panel>
        <PanelHeader
          plain
          eyebrow="Evidence"
          title="Wall thickness"
          subtitle="Not a matching gate. It is what depth is a percentage of, and what fitness-for-service refuses to run without."
        />
        <PanelBody className="ds-stack">
          <div className="ds-row">
            {WALL_THICKNESS_SOURCES.map((source) => (
              <Button
                key={source.id}
                size="sm"
                variant={current.wall_thickness_source === source.id ? 'primary' : 'secondary'}
                aria-pressed={current.wall_thickness_source === source.id}
                onClick={() => patch({
                  wall_thickness_source: source.id as WallThicknessSource,
                })}
              >
                {source.label}
              </Button>
            ))}
          </div>
          <p className="tol-row__desc">
            {WALL_THICKNESS_SOURCES.find(
              (source) => source.id === current.wall_thickness_source,
            )?.hint}
          </p>
          {current.wall_thickness_source === 'gw' && (
            <Callout tone="info" icon={<FiLayers aria-hidden="true" />}>
              A pipe joint is one piece of pipe rolled to one thickness, so metal loss between two
              girth welds sits in metal of exactly the thickness those welds report. Only blanks are
              filled — a reported reading is never replaced — and the value is taken from the
              upstream weld of that joint, or the downstream one when the upstream weld reports
              none. Nothing is read from further away. Every result row records whether its
              thickness was reported at the defect or taken from the joint.
            </Callout>
          )}
        </PanelBody>
      </Panel>

      {/* Clustered metal loss ---------------------------------------------- */}
      <Panel>
        <PanelHeader
          plain
          eyebrow="Evidence"
          title="Clustered metal loss"
          subtitle="Whether a vendor-merged corrosion group is a defect with an identity across runs, or a grouping this vendor redraws every time."
        />
        <PanelBody className="ds-stack">
          <div className="ds-row">
            {CLUSTER_ALIGNMENT_MODES.map((mode) => (
              <Button
                key={mode.id}
                size="sm"
                variant={current.cluster_alignment === mode.id ? 'primary' : 'secondary'}
                aria-pressed={current.cluster_alignment === mode.id}
                onClick={() => patch({ cluster_alignment: mode.id as ClusterAlignment })}
              >
                {mode.label}
              </Button>
            ))}
          </div>
          <p className="tol-row__desc">
            {CLUSTER_ALIGNMENT_MODES.find((mode) => mode.id === current.cluster_alignment)?.hint}
          </p>
          {current.cluster_alignment === 'align' ? (
            <Callout tone="warning" icon={<FiGrid aria-hidden="true" />}>
              A cluster’s reported extent is a bounding box over several pits. Align them only when
              this vendor grouped both runs by the same rule — otherwise the pair compares two
              different populations of metal loss, and the growth rate that comes out of it measures
              the regrouping rather than the corrosion. The rows are matched on their reported
              dimensions like any other anomaly, so the depth and length in the result are the
              cluster’s envelope, not a single defect’s.
            </Callout>
          ) : (
            <Callout tone="info" icon={<FiGrid aria-hidden="true" />}>
              Clusters stay in the result table in distance order and still feed ERF and
              fitness-for-service, which read one run’s reported dimensions. What they lose is the
              run-pair growth rate: a cluster’s remnant life falls back to the zero-baseline or
              fallback rate, and its ERF at the survey date is unchanged.
            </Callout>
          )}
        </PanelBody>
      </Panel>

      {/* Tolerances + projection ----------------------------------------- */}
      <div className="tol-layout">
        <div className="ds-stack">
          <Panel>
            <div className="tol-table" role="group" aria-label="Engine tolerances">
              <div className="tol-table__head" aria-hidden="true">
                <span>Tolerance</span>
                <span>Range (min – max)</span>
                <span>Current</span>
                <span>Impact &amp; guidance</span>
              </div>

              {TOLERANCE_SPECS.map((spec) => (
                <ToleranceRow
                  key={spec.key}
                  spec={spec}
                  value={current[spec.key]}
                  disabled={
                    !gatesApply
                    || (
                      spec.key === 'us_gw_distance_tolerance'
                      && current.us_gw_distance_source === 'off'
                    )
                  }
                  onChange={(value) => patch({ [spec.key]: value } as Partial<ToleranceValues>)}
                >
                  {spec.key === 'us_gw_distance_tolerance' && (
                    <p className="tol-row__desc">
                      Source: <strong>{US_GW_DISTANCE_SOURCES.find(
                        (source) => source.id === current.us_gw_distance_source,
                      )?.label}</strong> — set above.
                    </p>
                  )}
                </ToleranceRow>
              ))}
            </div>
          </Panel>

          <Callout tone="warning" icon={<FiAlertTriangle aria-hidden="true" />}>
            Depth is not used to choose pairs. Once the Hungarian pass finishes, a NEW depth smaller
            than OLD is flagged as a physics validation for review and stays visible in the report.
          </Callout>
        </div>

        {/* Projection panel ---------------------------------------------- */}
        <Panel className="tol-preview">
          <PanelHeader
            plain
            title="Projected effect on candidate matches"
            subtitle="How stricter or looser tolerances change match yield and review effort."
          />
          <PanelBody className="ds-stack">
            {!gatesApply ? (
              <p className="tol-preview__empty">
                This projection models how many candidates each distance gate lets through. The
                selected matcher has no gates, so there is nothing to project: it reports a
                posterior probability per accepted pair instead, calculated from the run’s own
                measured spread once the alignment has been executed.
              </p>
            ) : !columns || !baseline ? (
              <p className="tol-preview__empty">
                Feature counts for this run pair are not available, so the projection cannot be
                calculated. Complete the data review step first.
              </p>
            ) : (
              <>
                <table className="tol-matrix">
                  <thead>
                    <tr>
                      <td />
                      {columns.map((column) => (
                        <th key={column.id} scope="col" className={column.id === 'current' ? 'is-current' : undefined}>
                          {column.id === 'current' ? (
                            <span>{column.label}</span>
                          ) : (
                            <button type="button" onClick={() => applyValues(column.values)}>
                              {column.label}
                              <small>apply</small>
                            </button>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <MetricRow
                      icon={<FiUsers aria-hidden="true" />}
                      label="Candidate pairs"
                      columns={columns.map((column) => {
                        const delta = percentDelta(column.projection.candidatePairs, baseline.candidatePairs);
                        return {
                          id: column.id,
                          value: column.projection.candidatePairs.toLocaleString(),
                          delta: column.id === 'current' || delta === null ? null : formatSignedPercent(delta),
                          tone: delta === null || column.id === 'current' ? null : delta > 0 ? 'up' : 'down',
                        };
                      })}
                    />
                    <MetricRow
                      icon={<FiFileText aria-hidden="true" />}
                      label="Expected review"
                      columns={columns.map((column) => {
                        const delta = percentDelta(column.projection.reviewHours, baseline.reviewHours);
                        return {
                          id: column.id,
                          value: formatHours(column.projection.reviewHours),
                          delta: column.id === 'current' || delta === null ? null : formatSignedPercent(delta),
                          tone: delta === null || column.id === 'current' ? null : delta > 0 ? 'up' : 'down',
                        };
                      })}
                    />
                    <MetricRow
                      icon={<FiShield aria-hidden="true" />}
                      label="Confidence"
                      columns={columns.map((column) => {
                        const delta = column.projection.confidence - baseline.confidence;
                        return {
                          id: column.id,
                          value: `${Math.round(column.projection.confidence)}%`,
                          delta: column.id === 'current' ? null : formatSignedPoints(delta),
                          tone: column.id === 'current' ? null : delta > 0 ? 'down' : 'up',
                        };
                      })}
                    />
                  </tbody>
                </table>

                <ul className="tol-legend">
                  <li><i className="tol-legend__dot tol-legend__dot--strict" aria-hidden="true" />Stricter — fewer pairs, higher confidence, less review.</li>
                  <li><i className="tol-legend__dot tol-legend__dot--current" aria-hidden="true" />Current — the configuration that will run.</li>
                  <li><i className="tol-legend__dot tol-legend__dot--loose" aria-hidden="true" />Looser — more pairs, lower confidence, more review.</li>
                </ul>

                <p className="tol-preview__caveat">
                  Modelled from this run pair&apos;s metal-loss counts, not a dry run of the matcher.
                  Read the direction and rough size of a change, not the absolute figures.
                </p>
              </>
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* Footer ----------------------------------------------------------- */}
      <Panel className="tol-footer">
        <div className="tol-footer__bar">
          <button
            type="button"
            className="tol-footer__disclosure"
            aria-expanded={showAssumptions}
            onClick={() => setShowAssumptions((open) => !open)}
          >
            <FiSettings aria-hidden="true" />
            Projection assumptions
            <FiChevronDown aria-hidden="true" className={showAssumptions ? 'is-open' : undefined} />
          </button>

          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiRotateCcw aria-hidden="true" />}
            disabled={!isDirty}
            onClick={() => applyValues(defaults.shared)}
          >
            Reset to defaults
          </Button>

          <div className="tol-footer__status">
            {isDirty ? (
              <>
                <i className="tol-footer__dot" aria-hidden="true" />
                <span><strong>Unsaved changes.</strong> Continue to apply them to the run.</span>
              </>
            ) : (
              <span>Tolerances match the saved configuration.</span>
            )}
          </div>
        </div>

        {showAssumptions && (
          <PanelBody className="tol-footer__assumptions">
            <label>
              <span>Candidates per defect</span>
              <input
                type="number"
                className="ds-input ds-input--sm"
                min={1}
                max={20}
                step={1}
                value={assumptions.neighbourhood}
                onChange={(event) => setAssumptions((value) => ({
                  ...value,
                  neighbourhood: Math.min(20, Math.max(1, Number(event.target.value) || 1)),
                }))}
              />
              <small>New-run anomalies sharing a locked GW section with each old-run defect.</small>
            </label>
            <label>
              <span>Seconds per pair</span>
              <input
                type="number"
                className="ds-input ds-input--sm"
                min={0.5}
                max={60}
                step={0.5}
                value={assumptions.secondsPerPair}
                onChange={(event) => setAssumptions((value) => ({
                  ...value,
                  secondsPerPair: Math.min(60, Math.max(0.5, Number(event.target.value) || 0.5)),
                }))}
              />
              <small>Analyst time to confirm or reject one candidate pair.</small>
            </label>
          </PanelBody>
        )}
      </Panel>

      <ActionBar
        back={
          <Button variant="ghost" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={onBack}>
            Feature rules
          </Button>
        }
        next={
          <Button endIcon={<FiChevronRight aria-hidden="true" />} onClick={handleNext}>
            Execute Hungarian matcher
          </Button>
        }
      />
    </div>
  );
}
