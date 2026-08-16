/**
 * Step 8 — Inspection plan and risk management (API 580 §13, §14).
 *
 * §12.3.2 frames inspection planning as five questions: what to inspect, how
 * (technique), where (location), how much (coverage), and when. Most tools
 * answer only the last one, and §13.4 says exactly what that costs — "spot
 * thickness readings on a piping circuit would be considered to have little or
 * no benefit if the damage mechanism results in unpredictable localised
 * corrosion". An interval attached to the wrong technique is not a plan.
 *
 * So the interval is derived and the other four are asked for. §13.1 adds the
 * strategies to consider beyond inspecting — decommission, inspect and repair,
 * reduce the consequence, reduce the probability — and §16.9 asks for the risk
 * that is expected to remain once the chosen one is done. That last figure is a
 * judgement and stays a judgement: this product will not compute a residual risk
 * on an engineer's behalf.
 */

import { FiAlertTriangle } from 'react-icons/fi';

import { Badge, Callout } from '../../../components/ds';
import { RISK_LEVELS } from '../../../lib/rbi/api580';
import { emptyUnitPlan, mechanismName } from '../../../lib/rbi/record';
import { RiskTag } from '../RiskMatrix';
import {
  DateField,
  DerivedValue,
  EmptyState,
  FieldGrid,
  FullWidth,
  NoteField,
  NumberField,
  PickField,
  RowCard,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { Option } from '../../../lib/rbi/catalogues';
import type { RbiMitigationStrategy, RbiUnitPlan, RiskLevel } from '../../../lib/rbi/types';

const STRATEGY_OPTIONS: readonly Option<RbiMitigationStrategy>[] = [
  { value: 'none', label: 'None — risk is acceptable as it stands' },
  { value: 'inspection-repair', label: 'Inspection and repair (§13.1 b)' },
  { value: 'pof-mitigation', label: 'Reduce the probability (§13.1 d)', hint: 'Material, operating or design change.' },
  { value: 'cof-mitigation', label: 'Reduce the consequence (§13.1 c)', hint: 'Isolation, detection, inventory reduction.' },
  { value: 'decommission', label: 'Decommission (§13.1 a)', hint: 'Is the equipment really needed to support operation?' },
];

const RESIDUAL_OPTIONS: readonly Option<RiskLevel | 'none'>[] = [
  { value: 'none', label: 'Not stated' },
  ...RISK_LEVELS.map((level) => ({ value: level, label: level })),
];

const BASIS_LABEL: Record<string, string> = {
  'half-remaining-life': 'Half the remaining life',
  'risk-target-interval': 'Risk-based target',
  'jurisdictional-limit': 'Jurisdictional limit',
  'engineer-override': 'Engineer override',
  'immediate-action': 'Immediate action',
  'no-basis': 'No basis',
};

export default function StepPlan({ record, update, assessment }: StepProps) {
  const planFor = (unitId: string): RbiUnitPlan => (
    record.unitPlans.find((row) => row.unitId === unitId) ?? emptyUnitPlan(unitId)
  );

  const patchPlan = (unitId: string, patch: Partial<RbiUnitPlan>) => {
    update((current) => {
      const existing = current.unitPlans.find((row) => row.unitId === unitId);
      const next = { ...(existing ?? emptyUnitPlan(unitId)), ...patch };
      return {
        ...current,
        unitPlans: existing
          ? current.unitPlans.map((row) => (row.unitId === unitId ? next : row))
          : [...current.unitPlans, next],
      };
    });
  };

  const techniqueHints = record.dmr.mechanisms
    .filter((row) => row.status !== 'ruled-out' && row.plannedTechnique.trim() !== '')
    .map((row) => `${mechanismName(row)}: ${row.plannedTechnique}`);

  const orphaned = record.unitPlans.filter(
    (row) => !(assessment?.units ?? []).some((unit) => unit.id === row.unitId),
  );

  return (
    <>
      {techniqueHints.length > 0 && (
        <StepPanel
          title="Techniques the damage mechanism review called for"
          section="§13.2.2 c"
          blurb="Carried forward from step 5. The plan below should reach every credible mechanism, not only
            the one the last run happened to measure."
        >
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {techniqueHints.map((hint) => (
              <li key={hint} className="rbi-check__hint" style={{ display: 'list-item' }}>{hint}</li>
            ))}
          </ul>
        </StepPanel>
      )}

      <StepPanel
        title="Inspection plan by section"
        section="§12.3.2 · §13"
        blurb="What, how, where, how much — and when. The interval is derived from the measured remaining life
          and capped by the risk level; the other four are yours."
      >
        {!assessment && (
          <EmptyState>
            No filed FFS assessment is attached, so there are no sections to plan against. Attach one from the
            assessment header.
          </EmptyState>
        )}

        {assessment?.units.map((unit) => {
          const plan = planFor(unit.id);
          const overridden = plan.overrideIntervalYears !== null;
          return (
            <RowCard
              key={unit.id}
              title={unit.label}
              meta={(
                <>
                  <RiskTag level={unit.riskLevel} />
                  <Badge tone={unit.acceptance === 'unacceptable' ? 'danger' : unit.acceptance === 'tolerable' ? 'warning' : 'success'} pill>
                    {unit.acceptance}
                  </Badge>
                </>
              )}
            >
              <p className="rbi-check__hint" style={{ marginBottom: '0.625rem' }}>
                {unit.inspection.recommendation}
              </p>

              <FieldGrid columns={3}>
                <DerivedValue
                  label="Derived interval"
                  value={unit.inspection.intervalYears === null
                    ? 'No basis'
                    : `${unit.inspection.intervalYears} years`}
                  source={BASIS_LABEL[unit.inspection.basis] ?? unit.inspection.basis}
                />
                <DerivedValue
                  label="Next inspection due"
                  value={unit.inspection.dueDateIso ?? '—'}
                  source={`Counted from the inspection date, ${assessment.assessmentDateIso}.`}
                />
                <DerivedValue
                  label="Governing evidence"
                  value={unit.governingFeature?.featureId ?? '—'}
                  source={unit.governingFeature
                    ? `At ${unit.governingFeature.ldM?.toFixed(0) ?? '—'} m`
                      + (unit.governingFeature.erf === null ? '' : `, ERF ${unit.governingFeature.erf.toFixed(3)}`)
                    : 'No assessed feature in this section.'}
                />
              </FieldGrid>

              <FieldGrid columns={3}>
                <TextField
                  label="Technique — how to inspect"
                  value={plan.technique}
                  onChange={(value) => patchPlan(unit.id, { technique: value })}
                  placeholder="e.g. High-resolution MFL with crack-detection EMAT"
                />
                <NumberField
                  label="Coverage — how much"
                  unit="%"
                  value={plan.coveragePct}
                  onChange={(value) => patchPlan(unit.id, { coveragePct: value })}
                  min={0}
                />
                <TextField
                  label="Locations — where"
                  value={plan.locations}
                  onChange={(value) => patchPlan(unit.id, { locations: value })}
                  placeholder="e.g. Bottom quadrant, KP 12.4–14.1, road crossing"
                />
              </FieldGrid>

              <FieldGrid columns={3}>
                <PickField
                  label="Risk management strategy (§13.1)"
                  value={plan.strategy}
                  options={STRATEGY_OPTIONS}
                  onChange={(value) => patchPlan(unit.id, { strategy: value })}
                />
                <TextField
                  label="Owner"
                  value={plan.owner}
                  onChange={(value) => patchPlan(unit.id, { owner: value })}
                />
                <DateField
                  label="Target date"
                  value={plan.targetDateIso}
                  onChange={(value) => patchPlan(unit.id, { targetDateIso: value })}
                />
                <PickField
                  label="Residual risk after mitigation (§16.9)"
                  hint="Your judgement. The tool will not compute the risk a mitigation leaves behind."
                  value={plan.residualRiskLevel ?? 'none'}
                  options={RESIDUAL_OPTIONS}
                  onChange={(value) => patchPlan(unit.id, {
                    residualRiskLevel: value === 'none' ? null : value,
                  })}
                />
                <NumberField
                  label="Override the interval"
                  unit="years"
                  hint="Only where engineering judgement differs from the derived figure."
                  value={plan.overrideIntervalYears}
                  onChange={(value) => patchPlan(unit.id, { overrideIntervalYears: value })}
                  min={0}
                />
                {overridden && (
                  <TextField
                    label="Reason for the override (§16.7 — a shall)"
                    value={plan.overrideReason}
                    onChange={(value) => patchPlan(unit.id, { overrideReason: value })}
                  />
                )}
                <FullWidth>
                  <NoteField
                    label="Mitigation detail"
                    rows={2}
                    hint="§13.6 — the extent of repair or replacement, the method, the QA/QC, and the date it
                      should be complete."
                    value={plan.mitigationNote}
                    onChange={(value) => patchPlan(unit.id, { mitigationNote: value })}
                  />
                </FullWidth>
              </FieldGrid>

              {overridden && plan.overrideReason.trim() === '' && (
                <Callout tone="danger" icon={<FiAlertTriangle />} title="An override needs its reason">
                  §16.7 requires deviations from the prescribed procedure and their basis to be documented.
                </Callout>
              )}

              {unit.acceptance === 'unacceptable' && plan.strategy === 'none' && (
                <Callout tone="danger" icon={<FiAlertTriangle />} title="Unacceptable risk with no strategy">
                  §13.3: items with unacceptable risk shall be assessed for risk management through inspection
                  plans or other strategies. Choose one of the four above, or change the acceptance criteria
                  deliberately on step 7.
                </Callout>
              )}
            </RowCard>
          );
        })}

        {orphaned.length > 0 && (
          <Callout tone="warning" title={`${orphaned.length} plan(s) for sections not in the current assessment`}>
            {orphaned.map((row) => row.unitId).join(', ')}. They are kept — a re-run of the alignment may
            bring the section back — but they are planning nothing right now.
          </Callout>
        )}
      </StepPanel>
    </>
  );
}
