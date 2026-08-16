/**
 * Step 6 — Consequence of failure (API 580 §11).
 *
 * The four axes §11.1.1 names — safety and health, environmental, economic,
 * reputation — are asked for separately and scored separately, because they are
 * mitigated by completely different actions (§13.1 c) and because collapsing
 * them into one dropdown destroys exactly the discrimination §11.1.1 says the
 * analysis exists to provide.
 *
 * The section overrides at the bottom are the pipeline-specific part. A
 * transmission line is remote for forty kilometres and then crosses a river, a
 * road and a village; a single line-wide consequence category would put the
 * crossing and the empty desert in the same box, which is the one thing a
 * consequence analysis must not do.
 */

import { FiPlus } from 'react-icons/fi';

import { Badge, Button, Callout } from '../../../components/ds';
import { POPULATION_OPTIONS, RECEPTOR_OPTIONS } from '../../../lib/rbi/catalogues';
import { emptyConsequenceOverride } from '../../../lib/rbi/record';
import {
  DerivedValue,
  EmptyState,
  FieldGrid,
  FullWidth,
  NoteField,
  NumberField,
  PickField,
  RowCard,
  StepPanel,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { Option } from '../../../lib/rbi/catalogues';
import type {
  RbiConsequenceOverride,
  RbiEnvironmentReceptor,
  RbiPopulationClass,
  RiskCategory,
} from '../../../lib/rbi/types';

const REDUNDANCY: readonly Option<'full' | 'partial' | 'none'>[] = [
  { value: 'none', label: 'None — an outage stops production' },
  { value: 'partial', label: 'Partial — reduced throughput' },
  { value: 'full', label: 'Full — a spare or an alternative route' },
];

const CATEGORY_TONE: Record<RiskCategory, 'success' | 'warning' | 'danger'> = {
  1: 'success',
  2: 'success',
  3: 'warning',
  4: 'danger',
  5: 'danger',
};

/** The override selects allow "use the line default", which null represents. */
const POPULATION_OR_DEFAULT: readonly Option<RbiPopulationClass | 'default'>[] = [
  { value: 'default', label: 'Line default' },
  ...POPULATION_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

const RECEPTOR_OR_DEFAULT: readonly Option<RbiEnvironmentReceptor | 'default'>[] = [
  { value: 'default', label: 'Line default' },
  ...RECEPTOR_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

export default function StepCof({ record, update, assessment }: StepProps) {
  const { consequence } = record;
  const setConsequence = (patch: Partial<typeof consequence>) => {
    update((current) => ({ ...current, consequence: { ...current.consequence, ...patch } }));
  };
  const setOverrides = (overrides: RbiConsequenceOverride[]) => {
    update((current) => ({ ...current, consequenceOverrides: overrides }));
  };
  const patchOverride = (unitId: string, patch: Partial<RbiConsequenceOverride>) => {
    setOverrides(record.consequenceOverrides.map((row) => (
      row.unitId === unitId ? { ...row, ...patch } : row
    )));
  };

  const interruption = consequence.dailyUnitValueUsd !== null && consequence.downtimeDays !== null
    ? consequence.dailyUnitValueUsd * consequence.downtimeDays
    : null;

  const overriddenIds = new Set(record.consequenceOverrides.map((row) => row.unitId));
  const overridableUnits = (assessment?.units ?? []).filter((unit) => !overriddenIds.has(unit.id));

  // Every unit shares the line-default components except where overridden, so
  // the preview shows the first unit's breakdown as representative and the
  // per-unit table below carries the differences.
  const preview = assessment?.units[0] ?? null;

  return (
    <>
      <StepPanel
        title="Safety and health"
        section="§11.5.2 · §11.5.3 · §11.5.4"
        blurb="Flammable events, toxic releases and other hazardous fluids — the three §11.5.1 says shall be
          considered. The fluid comes from the process data on step 3."
      >
        <FieldGrid columns={3}>
          <DerivedValue
            label="Fluid"
            value={record.data.process.fluid.replace(/-/g, ' ')}
            source="From process conditions (§8). Change it there so the two steps cannot disagree."
          />
          <PickField
            label="Population exposure"
            hint="The line default. Sections that differ are overridden below."
            value={consequence.population}
            options={POPULATION_OPTIONS}
            onChange={(value) => setConsequence({ population: value })}
          />
          <NumberField
            label="Nearest occupancy"
            unit="m"
            value={consequence.publicProximityM}
            onChange={(value) => setConsequence({ publicProximityM: value })}
            min={0}
          />
          <NumberField
            label="Personnel in the affected area"
            unit="persons"
            hint="§11.5.4 b — people credibly inside the area a release would affect."
            value={consequence.personnelExposed}
            onChange={(value) => setConsequence({ personnelExposed: value })}
            min={0}
          />
          <FullWidth>
            <div className="rbi-checkgrid rbi-checkgrid--2">
              <label className="rbi-check">
                <input
                  type="checkbox"
                  checked={consequence.flammable}
                  onChange={(event) => setConsequence({ flammable: event.target.checked })}
                />
                <span>
                  <span className="rbi-check__label">Flammable release credible</span>
                  <span className="rbi-check__hint">
                    §11.5.2 — vapour cloud explosion, pool fire, jet fire, flash fire, BLEVE.
                  </span>
                </span>
              </label>
              <label className="rbi-check">
                <input
                  type="checkbox"
                  checked={consequence.toxicRelease}
                  onChange={(event) => setConsequence({ toxicRelease: event.target.checked })}
                />
                <span>
                  <span className="rbi-check__label">Toxic release credible</span>
                  <span className="rbi-check__hint">
                    §11.5.3 — needs no ignition and reaches further than a flammable release, so it cannot sit
                    in the lower half of the scale.
                  </span>
                </span>
              </label>
            </div>
          </FullWidth>
        </FieldGrid>

        <FieldGrid columns={3}>
          <DerivedValue
            label="Detection"
            value={record.data.inventory.detectionSystem}
            source="From inventory and isolation (§8)."
          />
          <DerivedValue
            label="Isolation"
            value={record.data.inventory.isolationSystem}
            source="From inventory and isolation (§8)."
          />
          <DerivedValue
            label="Volume available for release"
            value={record.data.inventory.volumeM3 === null
              ? 'Not stated'
              : `${record.data.inventory.volumeM3.toLocaleString()} m³`}
            source="§11.4 — the fluid between valves that can be quickly closed."
          />
        </FieldGrid>
      </StepPanel>

      <StepPanel
        title="Environmental"
        section="§11.5.5"
        blurb="“Environmental Cost = Cost for cleanup + Fines + Other costs.” The receptor sets the floor;
          the cost can only raise it."
      >
        <FieldGrid columns={3}>
          <PickField
            label="Receptor at risk"
            hint="The line default. Water crossings are overridden below."
            value={consequence.environmentReceptor}
            options={RECEPTOR_OPTIONS}
            onChange={(value) => setConsequence({ environmentReceptor: value })}
          />
          <NumberField
            label="Cleanup, fines and other costs"
            unit="USD"
            value={consequence.environmentalCostUsd}
            onChange={(value) => setConsequence({ environmentalCostUsd: value })}
            min={0}
          />
          <DerivedValue
            label="Spill containment"
            value={record.data.inventory.spillContainment}
            source="From inventory and isolation (§8). Full containment lowers this component by one category."
          />
        </FieldGrid>
      </StepPanel>

      <StepPanel
        title="Production and repair"
        section="§11.5.6 · §11.5.7"
        blurb="Business interruption is daily unit value × downtime days. Where it is not costed, the component
          falls back to redundancy alone — and the assessment reports that as the weaker basis it is."
      >
        <FieldGrid columns={3}>
          <NumberField
            label="Daily unit value"
            unit="USD/day"
            hint="Revenue or profit basis — state which in the note below."
            value={consequence.dailyUnitValueUsd}
            onChange={(value) => setConsequence({ dailyUnitValueUsd: value })}
            min={0}
          />
          <NumberField
            label="Downtime"
            unit="days"
            hint="Time to get back into production, not time to complete the repair."
            value={consequence.downtimeDays}
            onChange={(value) => setConsequence({ downtimeDays: value })}
            min={0}
          />
          <PickField
            label="Redundancy"
            value={consequence.redundancy}
            options={REDUNDANCY}
            onChange={(value) => setConsequence({ redundancy: value })}
          />
          <NumberField
            label="Repair and replacement cost"
            unit="USD"
            hint="§11.5.7 — the effort to correct the failure and replace what the subsequent events damaged."
            value={consequence.repairCostUsd}
            onChange={(value) => setConsequence({ repairCostUsd: value })}
            min={0}
          />
          <DerivedValue
            label="Business interruption"
            value={interruption === null ? 'Not quantified' : `${Math.round(interruption).toLocaleString()} USD`}
            source={interruption === null
              ? '§11.5.6 asks for this figure. Without it the production component is scored from redundancy.'
              : 'Daily unit value × downtime days.'}
          />
        </FieldGrid>

        <FieldGrid>
          <FullWidth>
            <NoteField
              label="Consequence basis (§16.7 f)"
              hint="The criteria used to evaluate each category, and the scenario the numbers describe.
                §11.6.2 asks for the consequence to be built from a stated scenario rather than a feeling."
              value={consequence.basisNote}
              onChange={(value) => setConsequence({ basisNote: value })}
              placeholder="e.g. Full-bore rupture at the river crossing, detected by SCADA imbalance within 8 minutes, isolated within 20. Revenue basis for the daily value."
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>

      {preview && (
        <StepPanel
          title="Derived consequence"
          section="§11.1.1"
          blurb="Four components, scored separately. The worst governs — a catastrophic safety consequence is
            not averaged away by a cheap repair."
        >
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Category</th>
                  <th scope="col">Driver</th>
                  <th scope="col">Value</th>
                  <th scope="col">Basis</th>
                </tr>
              </thead>
              <tbody>
                {preview.consequence.components.flatMap((component) => component.drivers.map((driver, at) => (
                  <tr key={`${component.id}-${driver.id}`}>
                    <th scope="row">{at === 0 ? component.label : ''}</th>
                    <td className="ds-data">{at === 0 ? component.category : ''}</td>
                    <td>{driver.label}</td>
                    <td className="ds-data">
                      {driver.value === null ? '—' : `${driver.value} ${driver.unit}`}
                    </td>
                    <td>{driver.basis}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>

          <FieldGrid columns={2}>
            <DerivedValue
              label={`Governing consequence — ${preview.label}`}
              value={preview.consequence.category}
              source="The worst of the four components, raised one category where bore × pressure is at or above 3 m·MPa."
            />
            <DerivedValue
              label="Units sharing this category"
              value={(assessment?.units ?? []).filter(
                (unit) => unit.consequence.category === preview.consequence.category,
              ).length}
              source="Units with an override may differ; see the table below."
            />
          </FieldGrid>
        </StepPanel>
      )}

      <StepPanel
        title="Section overrides"
        section="§11.1.1"
        blurb="Where a stretch of line differs from the default. The consequence analysis exists to
          discriminate between items; one category for a whole pipeline discriminates between none of them."
        actions={overridableUnits.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiPlus />}
            onClick={() => setOverrides([
              ...record.consequenceOverrides,
              emptyConsequenceOverride(overridableUnits[0].id),
            ])}
          >
            Override a section
          </Button>
        )}
      >
        {!assessment && (
          <EmptyState>
            Sections come from the filed FFS assessment. Attach one to override any of them.
          </EmptyState>
        )}

        {assessment && record.consequenceOverrides.length === 0 && (
          <EmptyState>
            No overrides; the line default applies throughout. That is correct for a line whose surroundings
            genuinely do not change — and worth a second look for one that crosses anything.
          </EmptyState>
        )}

        {record.consequenceOverrides.map((row) => {
          const unit = assessment?.units.find((item) => item.id === row.unitId) ?? null;
          const unitOptions: readonly Option[] = [
            ...(unit ? [{ value: unit.id, label: unit.label }] : [{ value: row.unitId, label: `${row.unitId} (not in the current assessment)` }]),
            ...overridableUnits.map((item) => ({ value: item.id, label: item.label })),
          ];
          return (
            <RowCard
              key={row.unitId}
              title={unit?.label ?? row.unitId}
              meta={unit
                ? <Badge tone={CATEGORY_TONE[unit.consequence.category]} pill>COF {unit.consequence.category}</Badge>
                : <Badge tone="warning" pill>orphaned</Badge>}
              removeLabel={`Remove the override for ${unit?.label ?? row.unitId}`}
              onRemove={() => setOverrides(
                record.consequenceOverrides.filter((item) => item.unitId !== row.unitId),
              )}
            >
              {!unit && (
                <Callout tone="warning" title="This section is not in the current assessment">
                  The override is kept — a re-run of the alignment may bring the section back — but it is
                  affecting nothing right now.
                </Callout>
              )}
              <FieldGrid columns={3}>
                <PickField
                  label="Section"
                  value={row.unitId}
                  options={unitOptions}
                  onChange={(value) => patchOverride(row.unitId, { unitId: value })}
                />
                <PickField
                  label="Population exposure"
                  value={row.population ?? 'default'}
                  options={POPULATION_OR_DEFAULT}
                  onChange={(value) => patchOverride(row.unitId, {
                    population: value === 'default' ? null : value,
                  })}
                />
                <PickField
                  label="Receptor at risk"
                  value={row.environmentReceptor ?? 'default'}
                  options={RECEPTOR_OR_DEFAULT}
                  onChange={(value) => patchOverride(row.unitId, {
                    environmentReceptor: value === 'default' ? null : value,
                  })}
                />
                <FullWidth>
                  <NoteField
                    label="Why this section differs"
                    rows={2}
                    value={row.note}
                    onChange={(value) => patchOverride(row.unitId, { note: value })}
                    placeholder="e.g. Crosses the Mahakam river and a village at KP 34.2."
                  />
                </FullWidth>
              </FieldGrid>
            </RowCard>
          );
        })}
      </StepPanel>
    </>
  );
}
