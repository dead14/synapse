/**
 * Step 1 — Planning the RBI programme (API 580 §6, §16.4, §16.6).
 *
 * §6.7 lists the keys to success for planning, and four of them are here: clear
 * objectives, adequately defined physical and operating boundaries, and a
 * defined time period for the assessment. The rest of the document depends on
 * these being answered, which is why they come first — a damage mechanism review
 * on an undefined boundary reviews nothing in particular.
 */

import { Callout } from '../../../components/ds';
import {
  CODES_AND_STANDARDS,
  EQUIPMENT_CLASSES,
  RBI_OBJECTIVES,
} from '../../../lib/rbi/catalogues';
import {
  CheckGrid,
  ConsideredField,
  DateField,
  FieldGrid,
  FullWidth,
  NoteField,
  NumberField,
  PickField,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { RbiApproach } from '../../../lib/rbi/types';

const APPROACHES: { value: RbiApproach; label: string; hint: string }[] = [
  {
    value: 'semi-quantitative',
    label: 'Semi-quantitative',
    hint: '§5.4 — the approach this product implements: measured evidence where it exists, stated categories '
      + 'where it does not.',
  },
  {
    value: 'qualitative',
    label: 'Qualitative',
    hint: 'Broad ranges and engineering judgement throughout. Not implemented here; the tool would still '
      + 'derive measured categories, which is more than a qualitative assessment claims.',
  },
  {
    value: 'quantitative',
    label: 'Quantitative',
    hint: 'Probability in events per year, from API 581. Not implemented here — recording it would make the '
      + 'output claim a precision it does not have.',
  },
];

export default function StepPlanning({ record, update }: StepProps) {
  const { planning } = record;
  const setPlanning = (patch: Partial<typeof planning>) => {
    update((current) => ({ ...current, planning: { ...current.planning, ...patch } }));
  };
  const setOperating = (patch: Partial<typeof planning.operating>) => {
    update((current) => ({
      ...current,
      planning: { ...current.planning, operating: { ...current.planning.operating, ...patch } },
    }));
  };

  const unsupportedApproach = planning.approach !== 'semi-quantitative';

  return (
    <>
      <StepPanel
        title="Objectives and type of assessment"
        section="§6.2 · §6.5"
        blurb="Why this assessment is being made, and how far the method is allowed to claim to go."
      >
        <FieldGrid>
          <FullWidth>
            <TextField
              label="Assessment title"
              hint="What this document is called on the register and on its cover sheet."
              value={record.title}
              onChange={(value) => update((current) => ({ ...current, title: value }))}
              placeholder="e.g. Trunkline A — API 580 assessment, 2026 ILI"
            />
          </FullWidth>

          <FullWidth>
            <CheckGrid
              label="Objectives (§6.2)"
              hint="§6.7 a makes clear objectives the first key to success. Pick every one that applies."
              options={RBI_OBJECTIVES}
              selected={planning.objectives}
              onChange={(values) => setPlanning({ objectives: values })}
            />
          </FullWidth>

          <FullWidth>
            <NoteField
              label="Objectives note"
              value={planning.objectivesNote}
              onChange={(value) => setPlanning({ objectivesNote: value })}
              placeholder="What decision is this assessment expected to support?"
            />
          </FullWidth>

          <PickField
            label="Type of assessment (§5.4)"
            value={planning.approach}
            onChange={(value) => setPlanning({ approach: value })}
            options={APPROACHES}
          />
          <NumberField
            label="Jurisdictional maximum inspection interval"
            unit="years"
            hint="A code or regulator's limit. It caps every derived interval — §12.7 does not treat one as advisory."
            value={planning.jurisdictionalMaxIntervalYears}
            onChange={(value) => setPlanning({ jurisdictionalMaxIntervalYears: value })}
            min={0}
          />
        </FieldGrid>

        {unsupportedApproach && (
          <Callout tone="warning" title="This tool does not perform that type of assessment">
            The probability side here is derived from measured metal loss and stated susceptibilities, which
            is semi-quantitative in the sense of §5.4. Recording a different type on the cover would make the
            output claim a rigour it does not have — change it back, or produce the assessment elsewhere and
            use this record only for the parts it does cover.
          </Callout>
        )}
      </StepPanel>

      <StepPanel
        title="Physical boundary and scope"
        section="§6.3 · §16.4"
        blurb="Where the assessment starts and stops, and — just as importantly — what it leaves out."
      >
        <FieldGrid columns={3}>
          <TextField
            label="Facility"
            value={planning.facility}
            onChange={(value) => setPlanning({ facility: value })}
            placeholder="e.g. Central Processing Plant"
          />
          <TextField
            label="Process unit"
            value={planning.processUnit}
            onChange={(value) => setPlanning({ processUnit: value })}
            placeholder="e.g. Export system"
          />
          <TextField
            label="System / piping circuit"
            hint="§6.3.4 — the grouping that shares a corrosivity and a set of damage mechanisms."
            value={planning.system}
            onChange={(value) => setPlanning({ system: value })}
          />
        </FieldGrid>

        <FieldGrid>
          <CheckGrid
            label="Equipment covered (§16.4)"
            options={EQUIPMENT_CLASSES}
            selected={planning.includedEquipment}
            onChange={(values) => setPlanning({ includedEquipment: values })}
          />
          <CheckGrid
            label="Equipment NOT covered (§16.4)"
            hint="§16.4 asks for both lists. An empty exclusion list reads as “everything is covered”, which is
              almost never what was meant."
            options={EQUIPMENT_CLASSES}
            selected={planning.excludedEquipment}
            onChange={(values) => setPlanning({ excludedEquipment: values })}
          />
        </FieldGrid>

        <FieldGrid>
          <FullWidth>
            <NoteField
              label="Scope rationale (§16.4 — a shall)"
              hint="Why these classes are in and the others are out. Shared resources such as flare systems and
                interconnecting piping need a deliberate answer."
              value={planning.scopeRationale}
              onChange={(value) => setPlanning({ scopeRationale: value })}
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>

      <StepPanel
        title="Operating boundary"
        section="§6.4"
        blurb="The conditions the assessment assumes. Operating outside them invalidates it, which is why §6.4.1
          asks for them to be recorded as limits."
      >
        <FieldGrid columns={3}>
          <NumberField
            label="Normal operating pressure"
            unit="MPa"
            value={planning.operating.normalPressureMpa}
            onChange={(value) => setOperating({ normalPressureMpa: value })}
          />
          <NumberField
            label="Minimum pressure"
            unit="MPa"
            value={planning.operating.minPressureMpa}
            onChange={(value) => setOperating({ minPressureMpa: value })}
          />
          <NumberField
            label="Maximum pressure"
            unit="MPa"
            value={planning.operating.maxPressureMpa}
            onChange={(value) => setOperating({ maxPressureMpa: value })}
          />
          <NumberField
            label="Normal operating temperature"
            unit="°C"
            value={planning.operating.normalTemperatureC}
            onChange={(value) => setOperating({ normalTemperatureC: value })}
          />
          <NumberField
            label="Minimum temperature"
            unit="°C"
            value={planning.operating.minTemperatureC}
            onChange={(value) => setOperating({ minTemperatureC: value })}
          />
          <NumberField
            label="Maximum temperature"
            unit="°C"
            value={planning.operating.maxTemperatureC}
            onChange={(value) => setOperating({ maxTemperatureC: value })}
          />
        </FieldGrid>

        <FieldGrid>
          <FullWidth>
            <NoteField
              label="Flow and throughput"
              rows={2}
              value={planning.operating.flowNote}
              onChange={(value) => setOperating({ flowNote: value })}
              placeholder="Rates and their variation, including turndown."
            />
          </FullWidth>
        </FieldGrid>

        <div className="rbi-grid rbi-grid--3">
          <ConsideredField
            label="Start-up and shutdown considered"
            hint="§6.4.2 — a shall for every item covered. PASCC is the textbook case: the risk is governed by
              what happens during shutdown, not during operation."
            checked={planning.operating.startupShutdownConsidered}
            onCheckedChange={(value) => setOperating({ startupShutdownConsidered: value })}
            note={planning.operating.startupShutdownNote}
            onNoteChange={(value) => setOperating({ startupShutdownNote: value })}
          />
          <ConsideredField
            label="Upset and abnormal conditions considered"
            hint="§6.4.3 — excursions in pressure, temperature or composition."
            checked={planning.operating.upsetConsidered}
            onCheckedChange={(value) => setOperating({ upsetConsidered: value })}
            note={planning.operating.upsetNote}
            onNoteChange={(value) => setOperating({ upsetNote: value })}
          />
          <ConsideredField
            label="Cyclic or intermittent operation considered"
            hint="§6.4.3 — the complete cyclic range, not the steady state between cycles."
            checked={planning.operating.cyclicConsidered}
            onCheckedChange={(value) => setOperating({ cyclicConsidered: value })}
            note={planning.operating.cyclicNote}
            onNoteChange={(value) => setOperating({ cyclicNote: value })}
          />
        </div>
      </StepPanel>

      <StepPanel
        title="Time period and applicable codes"
        section="§6.4.4 · §16.6 · §16.11"
        blurb="Risk is a function of time. An assessment with no stated window cannot be managed over one."
      >
        <FieldGrid columns={3}>
          <DateField
            label="Applicable from"
            value={planning.timeframeFromIso}
            onChange={(value) => setPlanning({ timeframeFromIso: value })}
          />
          <DateField
            label="Applicable to"
            hint="§16.6 — after this date the assessment is out of date, whatever it says."
            value={planning.timeframeToIso}
            onChange={(value) => setPlanning({ timeframeToIso: value })}
          />
          <NumberField
            label="Run length between turnarounds"
            unit="years"
            value={planning.runLengthYears}
            onChange={(value) => setPlanning({ runLengthYears: value })}
            min={0}
          />
        </FieldGrid>

        <FieldGrid>
          <FullWidth>
            <CheckGrid
              label="Codes and standards in force (§16.11)"
              hint="Particularly important where RBI is used to reduce the extent or frequency of inspection."
              options={CODES_AND_STANDARDS}
              selected={planning.codes}
              onChange={(values) => setPlanning({ codes: values })}
            />
          </FullWidth>
          <FullWidth>
            <NoteField
              label="Codes note"
              rows={2}
              value={planning.codesNote}
              onChange={(value) => setPlanning({ codesNote: value })}
              placeholder="Local regulation, company standards, and any deviation from them."
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>
    </>
  );
}
