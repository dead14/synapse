/**
 * Step 4 — Damage mechanism review (API 580 §9).
 *
 * The most consequential step in the document. §9.1: "The information derived
 * from the DMR is essential to the quality and the effectiveness of the risk
 * assessment since it is used to estimate the POF." Everything downstream is
 * only as good as this list.
 *
 * Three deliberate frictions. A mechanism arrives as *potential*, never active,
 * because activity is a finding and the catalogue has made none. Ruling one out
 * demands a reason, because §9.5 b makes ruling out inactive mechanisms a key to
 * success and a rule-out with no reason cannot be re-tested at the next
 * reassessment. And an IOW demands its action, because §16.1 i makes an
 * exceedance a reassessment trigger — a window with nobody to call is an alarm
 * wired to nothing.
 */

import { FiAlertTriangle, FiPlus } from 'react-icons/fi';

import { Badge, Button, Callout } from '../../../components/ds';
import {
  DAMAGE_MECHANISMS,
  FAILURE_MODE_OPTIONS,
  MECHANISM_GROUPS,
  OTHER_LOSS_CAUSES,
  RATE_BASIS_OPTIONS,
  SUSCEPTIBILITY_OPTIONS,
  damageMechanismById,
} from '../../../lib/rbi/catalogues';
import { emptyIow, mechanismName, mechanismRowFor, rowId } from '../../../lib/rbi/record';
import {
  CheckGrid,
  EmptyState,
  FieldGrid,
  FullWidth,
  NoteField,
  NumberField,
  PickField,
  RowCard,
  StepPanel,
  TextField,
  DateField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { Option } from '../../../lib/rbi/catalogues';
import type { RbiDamageMechanism, RbiIow, RbiMechanismStatus } from '../../../lib/rbi/types';

const STATUS_OPTIONS: readonly Option<RbiMechanismStatus>[] = [
  { value: 'active', label: 'Active — observed operating here', hint: 'Scored at full weight.' },
  { value: 'potential', label: 'Potential — credible, not observed', hint: 'Scored one category lower.' },
  { value: 'ruled-out', label: 'Ruled out — not credible', hint: 'Contributes nothing; the reason is required.' },
];

const STATUS_TONE: Record<RbiMechanismStatus, 'danger' | 'warning' | 'neutral'> = {
  active: 'danger',
  potential: 'warning',
  'ruled-out': 'neutral',
};

export default function StepDmr({ record, update }: StepProps) {
  const { dmr } = record;
  const setDmr = (patch: Partial<typeof dmr>) => {
    update((current) => ({ ...current, dmr: { ...current.dmr, ...patch } }));
  };
  const patchMechanism = (id: string, patch: Partial<RbiDamageMechanism>) => {
    setDmr({
      mechanisms: dmr.mechanisms.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  };
  const patchIow = (id: string, patch: Partial<RbiIow>) => {
    setDmr({ iows: dmr.iows.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  };

  const used = new Set(dmr.mechanisms.map((row) => row.mechanismId));
  const addable = MECHANISM_GROUPS.map((group) => ({
    group,
    items: DAMAGE_MECHANISMS.filter((item) => item.group === group.id && !used.has(item.id)),
  })).filter((entry) => entry.items.length > 0);

  const credible = dmr.mechanisms.filter((row) => row.status !== 'ruled-out');
  const missingReason = dmr.mechanisms.filter(
    (row) => row.status === 'ruled-out' && row.ruledOutReason.trim() === '',
  );

  const mechanismOptions: readonly Option[] = dmr.mechanisms.map((row) => ({
    value: row.id,
    label: mechanismName(row),
  }));

  return (
    <>
      <StepPanel
        title="Credible damage mechanisms"
        section="§9.1 · §9.2"
        blurb="The corrosion specialist's list. Metal loss measured by in-line inspection is seeded from the
          filed FFS case; everything a metal-loss run cannot see has to be added here or it is not in the
          probability at all."
        actions={(
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiPlus />}
            onClick={() => setDmr({
              mechanisms: [
                ...dmr.mechanisms,
                { ...mechanismRowFor('custom'), id: rowId('dm'), mechanismId: 'custom' },
              ],
            })}
          >
            Add custom
          </Button>
        )}
      >
        {dmr.mechanisms.length === 0 && (
          <EmptyState>
            No mechanisms recorded. §10.1 requires the probability analysis to address every credible
            mechanism the equipment is or can be susceptible to — until this list exists, the assessment
            covers measured metal loss alone.
          </EmptyState>
        )}

        {dmr.mechanisms.map((row) => {
          const definition = damageMechanismById(row.mechanismId);
          const isCustom = row.mechanismId === 'custom';
          const measured = row.rateBasis === 'measured-ili';
          return (
            <RowCard
              key={row.id}
              title={mechanismName(row)}
              meta={<Badge tone={STATUS_TONE[row.status]} pill>{row.status}</Badge>}
              removeLabel={`Remove ${mechanismName(row)}`}
              onRemove={() => setDmr({ mechanisms: dmr.mechanisms.filter((item) => item.id !== row.id) })}
            >
              {definition?.hint && <p className="rbi-check__hint" style={{ marginBottom: '0.5rem' }}>{definition.hint}</p>}

              <FieldGrid columns={3}>
                {isCustom && (
                  <TextField
                    label="Mechanism name"
                    value={row.customName}
                    onChange={(value) => patchMechanism(row.id, { customName: value })}
                  />
                )}
                <PickField
                  label="Status (§9.4.2)"
                  value={row.status}
                  options={STATUS_OPTIONS}
                  onChange={(value) => patchMechanism(row.id, { status: value })}
                />
                <TextField
                  label="Damage mode"
                  hint="Thinning, pitting, cracking — §9.1."
                  value={row.damageMode}
                  onChange={(value) => patchMechanism(row.id, { damageMode: value })}
                />
                <PickField
                  label="Failure mode"
                  hint="Decides which consequence is credible on step 6."
                  value={row.failureMode}
                  options={FAILURE_MODE_OPTIONS}
                  onChange={(value) => patchMechanism(row.id, { failureMode: value })}
                />
                <PickField
                  label="Rate basis (§9.2)"
                  value={row.rateBasis}
                  options={RATE_BASIS_OPTIONS}
                  onChange={(value) => patchMechanism(row.id, { rateBasis: value })}
                />
                {row.rateBasis === 'corrosion-rate' && (
                  <NumberField
                    label="Corrosion rate"
                    unit="mm/y"
                    hint="Screened to a remaining life against the corrosion allowance, or 80 % of nominal wall
                      where none was entered."
                    value={row.rateMmPerYear}
                    onChange={(value) => patchMechanism(row.id, { rateMmPerYear: value })}
                    min={0}
                  />
                )}
                {row.rateBasis === 'susceptibility' && (
                  <PickField
                    label="Susceptibility"
                    hint="High scores 4, medium 3, low 2. A judgement never reaches 5 on its own."
                    value={row.susceptibility}
                    options={SUSCEPTIBILITY_OPTIONS}
                    onChange={(value) => patchMechanism(row.id, { susceptibility: value })}
                  />
                )}
                {measured && (
                  <TextField
                    label="Scored from"
                    value="Filed B31G assessment"
                    onChange={() => undefined}
                    disabled
                    hint="The unit's own ERF, remaining life and depth carry this row."
                  />
                )}

                <FullWidth>
                  <NoteField
                    label="Evidence and basis (§16.7 c)"
                    rows={2}
                    value={row.basis}
                    onChange={(value) => patchMechanism(row.id, { basis: value })}
                    placeholder="What the rate or susceptibility rests on: inspection findings, published data, similar service, laboratory work."
                  />
                </FullWidth>

                {row.status === 'ruled-out' && (
                  <FullWidth>
                    <NoteField
                      label="Reason ruled out (§9.5 b — a shall)"
                      rows={2}
                      value={row.ruledOutReason}
                      onChange={(value) => patchMechanism(row.id, { ruledOutReason: value })}
                      placeholder="Why this mechanism is not credible here. It will be re-tested at the next reassessment against this reason."
                    />
                  </FullWidth>
                )}
              </FieldGrid>
            </RowCard>
          );
        })}

        {addable.length > 0 && (
          <div style={{ marginTop: '0.875rem' }}>
            <span className="ds-field__label">Add from the catalogue</span>
            <p className="rbi-check__hint" style={{ marginBottom: '0.5rem' }}>
              A starting list for a transmission pipeline, not a substitute for the review §9.1 requires.
              The specialist's job is to strike out what is not credible and add what is missing.
            </p>
            {addable.map(({ group, items }) => (
              <div key={group.id} className="ds-row" style={{ marginBottom: '0.375rem' }}>
                <span className="rbi-checklist__src" style={{ minWidth: '9rem' }}>{group.label}</span>
                {items.map((item) => (
                  <Button
                    key={item.id}
                    variant="soft"
                    size="xs"
                    startIcon={<FiPlus />}
                    title={item.hint}
                    onClick={() => setDmr({ mechanisms: [...dmr.mechanisms, mechanismRowFor(item.id)] })}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        )}

        {missingReason.length > 0 && (
          <Callout tone="danger" icon={<FiAlertTriangle />} title="Ruled-out mechanisms need a reason">
            {missingReason.map(mechanismName).join(', ')}. §9.5 b makes ruling out inactive mechanisms a key
            to success — but a rule-out with no reason cannot be re-tested when the process changes.
          </Callout>
        )}

        {credible.length > 0 && (
          <Callout tone="info" title={`${credible.length} credible mechanism(s) will carry the probability`}>
            The unit takes the worst of them, never an average. Inspection effectiveness is set on the next
            step, and it is what separates a mechanism that is understood from one that is merely listed.
          </Callout>
        )}
      </StepPanel>

      <StepPanel
        title="Integrity operating windows"
        section="§9.4 · §14.8"
        blurb="The process parameters that keep a mechanism dormant. An exceedance is a reassessment trigger
          under §16.1 i, so each window carries the action it triggers."
        actions={(
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiPlus />}
            onClick={() => setDmr({ iows: [...dmr.iows, emptyIow()] })}
          >
            Add window
          </Button>
        )}
      >
        {dmr.iows.length === 0 && (
          <EmptyState>
            No integrity operating windows recorded. §9.4 expects them to come out of this review, because the
            information needed for both is the same and the people in the room are the same.
          </EmptyState>
        )}

        {dmr.iows.map((row, index) => (
          <RowCard
            key={row.id}
            title={row.parameter.trim() || `Window ${index + 1}`}
            removeLabel={`Remove ${row.parameter.trim() || `window ${index + 1}`}`}
            onRemove={() => setDmr({ iows: dmr.iows.filter((item) => item.id !== row.id) })}
          >
            <FieldGrid columns={3}>
              <TextField
                label="Parameter"
                value={row.parameter}
                onChange={(value) => patchIow(row.id, { parameter: value })}
                placeholder="e.g. Water cut, velocity, inhibitor rate, pH"
              />
              <TextField
                label="Unit"
                value={row.unit}
                onChange={(value) => patchIow(row.id, { unit: value })}
                placeholder="%, m/s, ppm"
              />
              <PickField
                label="Protects against"
                value={row.mechanismRowId}
                placeholder="Select a mechanism"
                options={mechanismOptions}
                onChange={(value) => patchIow(row.id, { mechanismRowId: value })}
              />
              <NumberField
                label="Low limit"
                value={row.lowLimit}
                onChange={(value) => patchIow(row.id, { lowLimit: value })}
              />
              <NumberField
                label="High limit"
                value={row.highLimit}
                onChange={(value) => patchIow(row.id, { highLimit: value })}
              />
              <FullWidth>
                <NoteField
                  label="Action on exceedance"
                  rows={2}
                  value={row.actionOnExceedance}
                  onChange={(value) => patchIow(row.id, { actionOnExceedance: value })}
                  placeholder="Who is told, what they do, and whether it triggers a reassessment."
                />
              </FullWidth>
            </FieldGrid>
          </RowCard>
        ))}
      </StepPanel>

      <StepPanel
        title="Review record and other causes"
        section="§9.2 · §10.1"
        blurb="Where the rates came from, and the causes of loss of containment that are not damage mechanisms
          at all."
      >
        <FieldGrid columns={2}>
          <DateField
            label="Damage mechanism review date"
            value={dmr.reviewDateIso}
            onChange={(value) => setDmr({ reviewDateIso: value })}
          />
          <TextField
            label="Corrosion specialist"
            value={dmr.corrosionSpecialist}
            onChange={(value) => setDmr({ corrosionSpecialist: value })}
          />
          <FullWidth>
            <NoteField
              label="Sources of deterioration rate information (§9.2)"
              rows={2}
              value={dmr.rateSources}
              onChange={(value) => setDmr({ rateSources: value })}
              placeholder="Published or company data, laboratory testing, in-service monitoring, experience with similar equipment, inspection and operational history."
            />
          </FullWidth>
          <FullWidth>
            <CheckGrid
              label="Other causes of loss of containment considered (§10.1)"
              hint="Recorded as considered, not scored. §10.1 notes these “may be (but are not commonly)
                included in the POF analysis” — the record exists so the assessment does not imply it covered
                them."
              options={OTHER_LOSS_CAUSES}
              selected={dmr.otherCauses}
              onChange={(values) => setDmr({ otherCauses: values })}
            />
          </FullWidth>
          <FullWidth>
            <NoteField
              label="Other causes note"
              rows={2}
              value={dmr.otherCausesNote}
              onChange={(value) => setDmr({ otherCausesNote: value })}
              placeholder="What is being done about them, and where that work is recorded."
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>
    </>
  );
}
