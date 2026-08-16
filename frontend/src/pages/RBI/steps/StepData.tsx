/**
 * Step 3 — Data and information collection (API 580 §8).
 *
 * Two things distinguish this from a form. First, §8.3 makes validation a shall
 * with a named validator — data quality is a signature, not a feeling — so the
 * validator and the date sit at the top of the panel rather than buried at the
 * end. Second, the figures the filed FFS case already carries are shown as read
 * values with their source rather than asked for again: §8.3 lists clerical and
 * transcription error among the named causes of poor inspection data, and the
 * cheapest way to avoid one is not to invite it.
 */

import { FiPlus } from 'react-icons/fi';

import { Button, Callout } from '../../../components/ds';
import {
  DATA_SOURCES,
  DETECTION_OPTIONS,
  FLUID_OPTIONS,
  ISOLATION_OPTIONS,
} from '../../../lib/rbi/catalogues';
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
import type { RbiDataSource } from '../../../lib/rbi/types';

const AVAILABILITY: readonly Option<RbiDataSource['availability']>[] = [
  { value: 'available', label: 'Available' },
  { value: 'partial', label: 'Partial' },
  { value: 'unavailable', label: 'Unavailable' },
];

const QUALITY: readonly Option<RbiDataSource['quality']>[] = [
  { value: 'high', label: 'High — validated, current' },
  { value: 'medium', label: 'Medium — usable, some gaps' },
  { value: 'low', label: 'Low — outdated or unverified' },
];

const PHASES: readonly Option<'gas' | 'liquid' | 'two-phase'>[] = [
  { value: 'liquid', label: 'Liquid' },
  { value: 'gas', label: 'Gas' },
  { value: 'two-phase', label: 'Two-phase' },
];

const CONTAINMENT: readonly Option<'contained' | 'partial' | 'none'>[] = [
  { value: 'none', label: 'None — a spill reaches the ground' },
  { value: 'partial', label: 'Partial — bunded or sumped in places' },
  { value: 'contained', label: 'Contained — a full release is retained' },
];

/** Sources not yet on the list, so the picker never offers a duplicate. */
function remainingSources(used: readonly RbiDataSource[]): readonly Option[] {
  const taken = new Set(used.map((item) => item.id));
  return DATA_SOURCES.filter((item) => !taken.has(item.value));
}

export default function StepData({ record, update }: StepProps) {
  const { data } = record;
  const setData = (patch: Partial<typeof data>) => {
    update((current) => ({ ...current, data: { ...current.data, ...patch } }));
  };
  const setEquipment = (patch: Partial<typeof data.equipment>) => {
    setData({ equipment: { ...data.equipment, ...patch } });
  };
  const setProcess = (patch: Partial<typeof data.process>) => {
    setData({ process: { ...data.process, ...patch } });
  };
  const setInventory = (patch: Partial<typeof data.inventory>) => {
    setData({ inventory: { ...data.inventory, ...patch } });
  };

  const available = remainingSources(data.sources);
  const traceRecorded = data.process.h2sPpm !== null || data.process.co2Pct !== null
    || data.process.chloridesPpm !== null || data.process.composition.trim() !== '';

  return (
    <>
      <StepPanel
        title="Data validation"
        section="§8.3 — a shall"
        blurb="“Data inputs and assumptions shall be validated by qualified personnel such as process
          engineer/operator to review operating parameters used.”"
      >
        <FieldGrid columns={3}>
          <TextField
            label="Validated by"
            value={data.validatedBy}
            onChange={(value) => setData({ validatedBy: value })}
            placeholder="Name and role"
          />
          <DateField
            label="Validated on"
            value={data.validatedOnIso}
            onChange={(value) => setData({ validatedOnIso: value })}
          />
          <TextField
            label="Validation note"
            hint="What was checked, and anything discarded as poor quality (§8.6 e)."
            value={data.validationNote}
            onChange={(value) => setData({ validationNote: value })}
          />
        </FieldGrid>
      </StepPanel>

      <StepPanel
        title="Sources consulted"
        section="§8.5"
        blurb="Which records were opened, and what state they were in. §8.3 warns that outdated drawings and
          undocumented baselines can mask or inflate a corrosion rate."
        actions={available.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            startIcon={<FiPlus />}
            onClick={() => setData({
              sources: [
                ...data.sources,
                { id: available[0].value, availability: 'available', quality: 'medium', note: '' },
              ],
            })}
          >
            Add source
          </Button>
        )}
      >
        {data.sources.length === 0 && (
          <EmptyState>No sources recorded yet. Add the records this assessment was actually built from.</EmptyState>
        )}

        {data.sources.map((source, index) => {
          const definition = DATA_SOURCES.find((item) => item.value === source.id);
          const pickable = [...(definition ? [definition] : []), ...available];
          return (
            <RowCard
              key={`${source.id}-${index}`}
              title={definition?.label ?? source.id}
              removeLabel={`Remove ${definition?.label ?? source.id}`}
              onRemove={() => setData({ sources: data.sources.filter((_, at) => at !== index) })}
            >
              <FieldGrid columns={3}>
                <PickField
                  label="Source"
                  value={source.id}
                  options={pickable}
                  onChange={(value) => setData({
                    sources: data.sources.map((item, at) => (at === index ? { ...item, id: value } : item)),
                  })}
                />
                <PickField
                  label="Availability"
                  value={source.availability}
                  options={AVAILABILITY}
                  onChange={(value) => setData({
                    sources: data.sources.map((item, at) => (
                      at === index ? { ...item, availability: value } : item
                    )),
                  })}
                />
                <PickField
                  label="Quality (§8.3)"
                  value={source.quality}
                  options={QUALITY}
                  onChange={(value) => setData({
                    sources: data.sources.map((item, at) => (
                      at === index ? { ...item, quality: value } : item
                    )),
                  })}
                />
                <FullWidth>
                  <TextField
                    label="Note"
                    value={source.note}
                    onChange={(value) => setData({
                      sources: data.sources.map((item, at) => (at === index ? { ...item, note: value } : item)),
                    })}
                    placeholder="What it covered, what was missing, how old it was."
                  />
                </FullWidth>
              </FieldGrid>
            </RowCard>
          );
        })}
      </StepPanel>

      <StepPanel
        title="Equipment and design data"
        section="§8.2.1 · §9.1 a"
        blurb="The design side of the damage mechanism review. Diameter, wall, SMYS and commissioning year are
          read from the filed FFS case where it carries them."
      >
        <FieldGrid columns={3}>
          <NumberField
            label="Outer diameter"
            unit="mm"
            value={data.equipment.outerDiameterMm}
            onChange={(value) => setEquipment({ outerDiameterMm: value })}
            min={0}
          />
          <NumberField
            label="Nominal wall"
            unit="mm"
            hint="Also the fallback the corrosion-rate screen measures against when no allowance is entered."
            value={data.equipment.nominalWallMm}
            onChange={(value) => setEquipment({ nominalWallMm: value })}
            min={0}
          />
          <NumberField
            label="Corrosion allowance"
            unit="mm"
            hint="Preferred basis for screening a stated corrosion rate to a remaining life."
            value={data.equipment.corrosionAllowanceMm}
            onChange={(value) => setEquipment({ corrosionAllowanceMm: value })}
            min={0}
          />
          <TextField
            label="Material"
            value={data.equipment.material}
            onChange={(value) => setEquipment({ material: value })}
            placeholder="e.g. Carbon steel"
          />
          <TextField
            label="Grade"
            value={data.equipment.grade}
            onChange={(value) => setEquipment({ grade: value })}
            placeholder="e.g. API 5L X52"
          />
          <NumberField
            label="SMYS"
            unit="MPa"
            value={data.equipment.smysMpa}
            onChange={(value) => setEquipment({ smysMpa: value })}
            min={0}
          />
          <NumberField
            label="Design pressure"
            unit="MPa"
            value={data.equipment.designPressureMpa}
            onChange={(value) => setEquipment({ designPressureMpa: value })}
            min={0}
          />
          <NumberField
            label="Design temperature"
            unit="°C"
            value={data.equipment.designTemperatureC}
            onChange={(value) => setEquipment({ designTemperatureC: value })}
          />
          <NumberField
            label="Installed"
            unit="year"
            value={data.equipment.installedYear}
            onChange={(value) => setEquipment({ installedYear: value })}
            step={1}
          />
          <TextField
            label="Seam type"
            hint="Vintage seams carry their own damage history — §9.3 b, details of fabrication."
            value={data.equipment.seamType}
            onChange={(value) => setEquipment({ seamType: value })}
            placeholder="e.g. SAWL, ERW (pre-1970), seamless"
          />
          <TextField
            label="External coating"
            value={data.equipment.externalCoating}
            onChange={(value) => setEquipment({ externalCoating: value })}
            placeholder="e.g. 3LPE, FBE, coal tar enamel"
          />
          <TextField
            label="Cathodic protection"
            hint="§9.3 d — the external corrosion control measures and how well they are performing."
            value={data.equipment.cathodicProtection}
            onChange={(value) => setEquipment({ cathodicProtection: value })}
            placeholder="e.g. Impressed current, −950 mV on-potential"
          />
        </FieldGrid>

        <FieldGrid>
          <FullWidth>
            <label className="rbi-check">
              <input
                type="checkbox"
                checked={data.equipment.insulated}
                onChange={(event) => setEquipment({ insulated: event.target.checked })}
              />
              <span>
                <span className="rbi-check__label">Insulated</span>
                <span className="rbi-check__hint">
                  Makes corrosion under insulation credible on the next step. §6.2.7 e names removing
                  unnecessary insulation as a mitigation in its own right.
                </span>
              </span>
            </label>
          </FullWidth>
          <FullWidth>
            <NoteField
              label="Equipment note"
              rows={2}
              value={data.equipment.note}
              onChange={(value) => setEquipment({ note: value })}
            />
          </FullWidth>
        </FieldGrid>
      </StepPanel>

      <StepPanel
        title="Process conditions"
        section="§9.1 b"
        blurb="“Identifying trace constituents (ppm) in addition to the primary constituents in a process can be
          very important as trace constituents can have a significant effect on the damage mechanisms.”"
      >
        <FieldGrid columns={3}>
          <PickField
            label="Fluid"
            hint="Also drives the safety and environmental consequence on step 6."
            value={data.process.fluid}
            options={FLUID_OPTIONS}
            onChange={(value) => setProcess({ fluid: value })}
          />
          <PickField
            label="Phase"
            value={data.process.phase}
            options={PHASES}
            onChange={(value) => setProcess({ phase: value })}
          />
          <NumberField
            label="Velocity"
            unit="m/s"
            hint="The driver behind erosion-corrosion, and behind under-deposit attack when it is too low."
            value={data.process.velocityMs}
            onChange={(value) => setProcess({ velocityMs: value })}
            min={0}
          />
          <NumberField
            label="H₂S"
            unit="ppm"
            value={data.process.h2sPpm}
            onChange={(value) => setProcess({ h2sPpm: value })}
            min={0}
          />
          <NumberField
            label="CO₂"
            unit="%"
            value={data.process.co2Pct}
            onChange={(value) => setProcess({ co2Pct: value })}
            min={0}
          />
          <NumberField
            label="Chlorides"
            unit="ppm"
            value={data.process.chloridesPpm}
            onChange={(value) => setProcess({ chloridesPpm: value })}
            min={0}
          />
          <NumberField
            label="Water cut"
            unit="%"
            value={data.process.waterCutPct}
            onChange={(value) => setProcess({ waterCutPct: value })}
            min={0}
          />
          <NumberField
            label="pH"
            value={data.process.ph}
            onChange={(value) => setProcess({ ph: value })}
          />
        </FieldGrid>

        <FieldGrid>
          <FullWidth>
            <NoteField
              label="Composition"
              rows={2}
              value={data.process.composition}
              onChange={(value) => setProcess({ composition: value })}
              placeholder="Primary constituents, and any trace species not captured above. If none are present, say so — that is the answer §9.1 b is asking for."
            />
          </FullWidth>
          <FullWidth>
            <NoteField
              label="Injection and mixing points"
              rows={2}
              hint="§9.1 — “understanding that localized thinning may be caused by the method of fluid
                injection and agitation may be as important as knowing the corrosion mechanism”."
              value={data.process.injectionPoints}
              onChange={(value) => setProcess({ injectionPoints: value })}
            />
          </FullWidth>
        </FieldGrid>

        {!traceRecorded && (
          <Callout tone="warning" title="No composition or trace species recorded">
            §9.1 b singles these out by name. Record H₂S, CO₂ or chlorides — or state in the composition note
            that none are present. A blank field is not the same statement as “none”.
          </Callout>
        )}
      </StepPanel>

      <StepPanel
        title="Inventory, detection and isolation"
        section="§11.4"
        blurb="What can get out, and what stops it. The released volume is the fluid between isolation valves
          that can be quickly closed, so the isolation arrangement is part of the number."
      >
        <FieldGrid columns={3}>
          <NumberField
            label="Volume available for release"
            unit="m³"
            value={data.inventory.volumeM3}
            onChange={(value) => setInventory({ volumeM3: value })}
            min={0}
          />
          <NumberField
            label="Detection time"
            unit="min"
            value={data.inventory.detectionTimeMin}
            onChange={(value) => setInventory({ detectionTimeMin: value })}
            min={0}
          />
          <NumberField
            label="Isolation time"
            unit="min"
            value={data.inventory.isolationTimeMin}
            onChange={(value) => setInventory({ isolationTimeMin: value })}
            min={0}
          />
          <PickField
            label="Detection rating"
            value={data.inventory.detectionSystem}
            options={DETECTION_OPTIONS}
            onChange={(value) => setInventory({ detectionSystem: value })}
          />
          <PickField
            label="Isolation rating"
            value={data.inventory.isolationSystem}
            options={ISOLATION_OPTIONS}
            onChange={(value) => setInventory({ isolationSystem: value })}
          />
          <PickField
            label="Spill containment (§11.5.5 c)"
            value={data.inventory.spillContainment}
            options={CONTAINMENT}
            onChange={(value) => setInventory({ spillContainment: value })}
          />
          <FullWidth>
            <NoteField
              label="Isolation arrangement"
              rows={2}
              value={data.inventory.isolationDescription}
              onChange={(value) => setInventory({ isolationDescription: value })}
              placeholder="Valve spacing, actuation, and what is actually between them."
            />
          </FullWidth>
        </FieldGrid>

        <FieldGrid columns={3}>
          <DerivedValue
            label="Detection and isolation credit"
            value={data.inventory.detectionSystem === 'A' && data.inventory.isolationSystem === 'A'
              ? 'One category off the safety hazard'
              : 'None'}
            source="Both ratings must be A. §11.4 — safeguards reduce the volume released, not the people nearby."
          />
        </FieldGrid>
      </StepPanel>
    </>
  );
}
