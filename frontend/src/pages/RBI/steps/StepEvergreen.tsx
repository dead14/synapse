/**
 * Step 9 — Evergreening and reassessment (API 580 §15).
 *
 * §15.1 draws a distinction worth keeping: evergreening is the continuous upkeep
 * of the data as inspections land and equipment changes; reassessment is
 * revisiting the whole thing, including the assumptions and the scope. Both are
 * needed, and §15.2.1 makes the trigger process a shall — "The facility shall
 * have an effective work process that identifies when a reassessment is
 * necessary."
 *
 * The ten-year ceiling is not this product's invention: §15.1.3 points at API
 * 510 and API 570, which cap reassessment at ten years, and notes that stricter
 * jurisdictional requirements take precedence.
 */

import { Callout } from '../../../components/ds';
import { MAX_REASSESSMENT_YEARS, addYearsIso } from '../../../lib/rbi/api580';
import { REASSESSMENT_TRIGGERS } from '../../../lib/rbi/catalogues';
import {
  CheckGrid,
  DateField,
  DerivedValue,
  FieldGrid,
  FullWidth,
  NoteField,
  NumberField,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';

export default function StepEvergreen({ record, update, assessment }: StepProps) {
  const { evergreening } = record;
  const setEvergreening = (patch: Partial<typeof evergreening>) => {
    update((current) => ({
      ...current,
      evergreening: { ...current.evergreening, ...patch },
    }));
  };

  const interval = evergreening.reassessmentIntervalYears;
  const exceedsCeiling = interval !== null && interval > MAX_REASSESSMENT_YEARS;
  const suggested = interval !== null && assessment
    ? addYearsIso(assessment.assessmentDateIso, interval)
    : null;

  return (
    <>
      <StepPanel
        title="Reassessment triggers"
        section="§15.2 · §16.1 i — a shall"
        blurb="The events that send this assessment back for review before its time is up. §15.2.1 makes having
          the work process a shall; listing the triggers is how it becomes real."
      >
        <FieldGrid>
          <FullWidth>
            <CheckGrid
              label="Triggers"
              options={REASSESSMENT_TRIGGERS}
              selected={evergreening.triggers}
              onChange={(values) => setEvergreening({ triggers: values })}
            />
          </FullWidth>
          <FullWidth>
            <NoteField
              label="Trigger note"
              rows={2}
              hint="How each trigger reaches whoever owns this assessment. §15.4 c: MOC and RBI reassessment
                are connected, and the connection has to be a route, not an intention."
              value={evergreening.triggersNote}
              onChange={(value) => setEvergreening({ triggersNote: value })}
            />
          </FullWidth>
        </FieldGrid>

        {evergreening.triggers.length === 0 && (
          <Callout tone="danger" title="No triggers recorded">
            Without them the assessment can only expire on the calendar, and §15.2.3 identifies process change
            as the single event most often linked to unexpected failure — which will not wait for a date.
          </Callout>
        )}
      </StepPanel>

      <StepPanel
        title="Reassessment period"
        section="§15.3.2 · §16.1 j"
        blurb="Small changes accumulate. §15.3.2 asks for a default maximum period even where nothing
          significant has happened."
      >
        <FieldGrid columns={3}>
          <NumberField
            label="Maximum period between reassessments"
            unit="years"
            value={interval}
            onChange={(value) => setEvergreening({ reassessmentIntervalYears: value })}
            min={0}
          />
          <DateField
            label="Next reassessment due"
            value={evergreening.nextReassessmentIso}
            onChange={(value) => setEvergreening({ nextReassessmentIso: value })}
          />
          <DerivedValue
            label="Ceiling under API 510 / API 570"
            value={`${MAX_REASSESSMENT_YEARS} years`}
            source="§15.1.3 — a stricter jurisdictional requirement takes precedence over this."
          />
        </FieldGrid>

        {exceedsCeiling && (
          <Callout tone="danger" title={`${interval} years exceeds the ten-year ceiling`}>
            §15.1.3 records that API 510 and API 570 require a ten-year maximum between reassessments. A
            longer period needs an explicit jurisdictional basis, recorded in the RBI programme document.
          </Callout>
        )}

        {suggested !== null && evergreening.nextReassessmentIso === '' && (
          <Callout tone="info" title="Suggested due date">
            {suggested} — {interval} years from the inspection date this assessment was built on. Set it
            above; the tool will not fill in a date it was not asked for.
          </Callout>
        )}

        {assessment?.totals.nextDueIso && (
          <Callout tone="info" title="The inspection plan moves first">
            The earliest inspection on the plan falls due {assessment.totals.nextDueIso}. §15.2.2 makes its
            results a reassessment trigger in their own right, so this assessment will very likely be reopened
            before its calendar date.
          </Callout>
        )}
      </StepPanel>

      <StepPanel
        title="Evergreening"
        section="§15.1.1"
        blurb="The continuous half: inspection ratings recorded as work completes, MOCs and equipment changes
          fed back, new assets added, risk rankings refreshed after a turnaround."
      >
        <FieldGrid columns={2}>
          <TextField
            label="Evergreening owner"
            hint="Continuous work without a named owner does not happen."
            value={evergreening.evergreenOwner}
            onChange={(value) => setEvergreening({ evergreenOwner: value })}
          />
          <FullWidth>
            <NoteField
              label="Evergreening process"
              rows={3}
              value={evergreening.evergreenProcess}
              onChange={(value) => setEvergreening({ evergreenProcess: value })}
              placeholder="How inspection results, MOCs, and equipment changes reach this record between reassessments — and how often somebody checks that they did."
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>
    </>
  );
}
