/**
 * Step 5 — Probability of failure (API 580 §10).
 *
 * §10.4.1 reduces the whole of POF to two considerations: the damage mechanisms
 * and their rates, and "effectiveness of the inspection program to identify and
 * monitor the damage mechanisms so that the equipment can be repaired or
 * replaced prior to failure". The first was answered on the previous step. This
 * step is the second, and it is the one most RBI programmes skip — an
 * effectiveness grade is where a technique that cannot find the mechanism it was
 * pointed at stops counting as evidence.
 *
 * The derived probability is shown here rather than only at the end, because the
 * grade an engineer chooses moves a category, and hiding that until step 7 turns
 * a judgement into a surprise.
 */

import { FiAlertTriangle } from 'react-icons/fi';

import { Badge, Callout } from '../../../components/ds';
import { EFFECTIVENESS_OPTIONS } from '../../../lib/rbi/catalogues';
import { mechanismName } from '../../../lib/rbi/record';
import {
  DateField,
  DerivedValue,
  EmptyState,
  FieldGrid,
  FullWidth,
  NumberField,
  PickField,
  RowCard,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { RbiDamageMechanism, RiskCategory } from '../../../lib/rbi/types';

const CATEGORY_TONE: Record<RiskCategory, 'success' | 'warning' | 'danger' | 'neutral'> = {
  1: 'success',
  2: 'success',
  3: 'warning',
  4: 'danger',
  5: 'danger',
};

function deltaLabel(delta: number): string {
  if (delta === 0) return 'no change';
  return delta > 0 ? `+${delta} category` : `${delta} category`;
}

export default function StepPof({ record, update, assessment }: StepProps) {
  const patchMechanism = (id: string, patch: Partial<RbiDamageMechanism>) => {
    update((current) => ({
      ...current,
      dmr: {
        ...current.dmr,
        mechanisms: current.dmr.mechanisms.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      },
    }));
  };

  const credible = record.dmr.mechanisms.filter((row) => row.status !== 'ruled-out');
  const judged = credible.filter((row) => row.rateBasis !== 'measured-ili');
  const blind = credible.filter((row) => row.status === 'active' && row.effectiveness === 'none');

  return (
    <>
      <StepPanel
        title="Effectiveness of past inspections"
        section="§10.4.2 — a shall"
        blurb="“Inspections shall be evaluated to determine the effectiveness in finding the identified
          mechanisms.” Effectiveness is judged per mechanism, because a technique suited to general thinning
          is not evidence about cracking."
      >
        {credible.length === 0 && (
          <EmptyState>
            No credible mechanisms on the review. Go back to step 4 and record what the corrosion specialist
            considers credible — there is nothing here to rate the inspections against.
          </EmptyState>
        )}

        {credible.map((row) => {
          const measured = row.rateBasis === 'measured-ili';
          return (
            <RowCard
              key={row.id}
              title={mechanismName(row)}
              meta={<Badge tone={row.status === 'active' ? 'danger' : 'warning'} pill>{row.status}</Badge>}
            >
              {measured ? (
                <Callout tone="info" title="Effectiveness is not applied to a measured mechanism">
                  This mechanism is scored from the filed B31G assessment. There the inspection <em>is</em> the
                  measurement, so discounting a measured ERF for the quality of the run that measured it would
                  apply the same evidence twice. Record the method and coverage anyway — §10.4.2 d asks for
                  them, and the next reassessment will want to compare.
                </Callout>
              ) : null}

              <FieldGrid columns={3}>
                <PickField
                  label="Inspection effectiveness"
                  value={row.effectiveness}
                  options={EFFECTIVENESS_OPTIONS}
                  onChange={(value) => patchMechanism(row.id, { effectiveness: value })}
                  disabled={measured}
                />
                <TextField
                  label="NDE method"
                  hint="§10.4.2 — the technique, because effectiveness is a function of it."
                  value={row.inspectionMethod}
                  onChange={(value) => patchMechanism(row.id, { inspectionMethod: value })}
                  placeholder={row.plannedTechnique || 'e.g. MFL ILI, shear-wave UT, DCVG'}
                />
                <NumberField
                  label="Coverage"
                  unit="%"
                  hint="The extent inspected, not the extent walked past."
                  value={row.coveragePct}
                  onChange={(value) => patchMechanism(row.id, { coveragePct: value })}
                  min={0}
                />
                <DateField
                  label="Last inspection"
                  hint="§10.4.2 — the most recent inspection best reflects current operating conditions."
                  value={row.lastInspectionIso}
                  onChange={(value) => patchMechanism(row.id, { lastInspectionIso: value })}
                />
                <FullWidth>
                  <TextField
                    label="Planned technique for the next inspection"
                    hint="§13.2.2 c — carried into the inspection plan on step 8."
                    value={row.plannedTechnique}
                    onChange={(value) => patchMechanism(row.id, { plannedTechnique: value })}
                  />
                </FullWidth>
              </FieldGrid>
            </RowCard>
          );
        })}

        {blind.length > 0 && (
          <Callout tone="danger" icon={<FiAlertTriangle />} title="Active mechanisms with no inspection at all">
            {blind.map(mechanismName).join(', ')}. §10.4.2 turns on the reduction of uncertainty; where there
            has been no inspection there is no reduction, so the damage state is unknown. These are floored at
            category 3 — unknown, not safe — and the recommendation for every affected unit says so.
          </Callout>
        )}
      </StepPanel>

      <StepPanel
        title="Derived probability by unit"
        section="§10.4.3"
        blurb="Calculated per deterioration type and taken at its worst across the unit. Every row shows the
          number behind it, so a category can be checked rather than taken on trust."
      >
        {!assessment && (
          <EmptyState>
            No filed FFS assessment is attached, so there are no units to score. Attach one from the
            assessment header — API 580 needs measured damage to rank, and this product will not invent it.
          </EmptyState>
        )}

        {assessment?.units.map((unit) => (
          <RowCard
            key={unit.id}
            title={unit.label}
            meta={(
              <>
                <Badge tone={CATEGORY_TONE[unit.probability.category]} pill>
                  POF {unit.probability.category}
                </Badge>
                {unit.probability.growthAssumed && <Badge tone="warning" pill>assumed growth</Badge>}
              </>
            )}
          >
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th scope="col">Contribution</th>
                    <th scope="col">Value</th>
                    <th scope="col">Base</th>
                    <th scope="col">Effectiveness</th>
                    <th scope="col">Category</th>
                    <th scope="col">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {unit.probability.drivers.map((driver) => (
                    <tr key={driver.id}>
                      <th scope="row">
                        {driver.label}
                        {driver.measured
                          ? <Badge tone="success" pill>measured</Badge>
                          : <Badge tone="warning" pill>judged</Badge>}
                      </th>
                      <td className="ds-data">
                        {driver.value === null ? '—' : `${driver.value} ${driver.unit}`}
                      </td>
                      <td className="ds-data">{driver.category}</td>
                      <td className="ds-muted">n/a</td>
                      <td className="ds-data">{driver.category}</td>
                      <td>{driver.basis}</td>
                    </tr>
                  ))}
                  {unit.probability.mechanisms
                    .filter((item) => item.rateBasis !== 'measured-ili')
                    .map((item) => (
                      <tr key={item.rowId}>
                        <th scope="row">
                          {item.name}
                          <Badge tone="warning" pill>judged</Badge>
                        </th>
                        <td className="ds-muted">{item.status}</td>
                        <td className="ds-data">{item.baseCategory}</td>
                        <td className="ds-data">
                          {item.effectiveness} · {deltaLabel(item.effectivenessDelta)}
                        </td>
                        <td className="ds-data">{item.category}</td>
                        <td>{item.basis}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <FieldGrid columns={3}>
              <DerivedValue
                label="Unit probability"
                value={unit.probability.category}
                source={`Governed by ${unit.probability.governingMechanism ?? 'no mechanism'}. The worst contribution, never an average.`}
              />
              <DerivedValue
                label="Assessed features"
                value={unit.featureCount.toLocaleString()}
                source={unit.probability.unassessedCount > 0
                  ? `${unit.probability.unassessedCount.toLocaleString()} anomaly/anomalies here carried no B31G result.`
                  : 'Every anomaly in this unit carried a B31G result.'}
              />
              <DerivedValue
                label="Judged mechanisms"
                value={judged.length}
                source="Scored from a stated rate or susceptibility, not measured. Reported as a limitation on the assessment."
              />
            </FieldGrid>
          </RowCard>
        ))}
      </StepPanel>
    </>
  );
}
