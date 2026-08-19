/**
 * The pipeline dossier editor.
 *
 * One component behind the alignment intake and the pipeline register, so the
 * line record cannot be described one way when it is filed and another way when
 * it is read back. Values are held in the shown unit and converted on the way
 * out; see `domain/pipelineSpecForm.ts`.
 */

import { FiInfo, FiPlus, FiTrash2 } from 'react-icons/fi';
import { Field, Input, Select, Textarea, Button } from '../ds';
import {
  emptySegmentForm,
  reunitForm,
  type PipelineSegmentForm,
  type PipelineSpecForm,
} from '../../domain/pipelineSpecForm';
import { API_5L_SMYS_MPA, smysForGrade } from '../../domain/pipelineSpecification';
import { convertPressure, type LengthUnit, type PressureUnit } from '../../lib/ffs/units';

const ENVIRONMENTS = ['Onshore', 'Offshore', 'Subsea', 'Swamp'];
const PRODUCTS = [
  'Natural Gas (Dry)', 'Natural Gas (Wet)', 'Crude Oil', 'Refined Product', 'Water', 'Multiphase',
];
const SEAM_TYPES = ['SMLS (Seamless)', 'ERW', 'DSAW', 'SAWL', 'SAWH', 'Furnace butt welded'];
const COATINGS = ['3LPE', '3LPP', 'FBE', 'Coal Tar Enamel (CTE)', 'Asphalt Enamel', 'Bare'];
const LOCATION_CLASSES = ['Class 1', 'Class 2', 'Class 3', 'Class 4'];
const GRADES = Object.keys(API_5L_SMYS_MPA);

interface PipelineSpecFieldsProps {
  value: PipelineSpecForm;
  onChange: (next: PipelineSpecForm) => void;
  disabled?: boolean;
  /** Problems to show above the segment register, already worded for a reader. */
  problems?: string[];
}

export default function PipelineSpecFields({
  value, onChange, disabled = false, problems = [],
}: PipelineSpecFieldsProps) {
  const set = <Key extends keyof PipelineSpecForm>(field: Key, next: PipelineSpecForm[Key]) => {
    onChange({ ...value, [field]: next });
  };

  /**
   * Picking a grade fills SMYS in from API 5L where the field is still blank.
   * A number the engineer typed is never replaced: a pipe dossier that names a
   * grade and states a different measured SMYS is stating the measurement.
   */
  const setGrade = (grade: string) => {
    const suggested = smysForGrade(grade);
    const shouldSuggest = value.smys.trim() === '' && suggested !== null;
    onChange({
      ...value,
      materialGrade: grade,
      smys: shouldSuggest
        ? Number(convertPressure(suggested, 'MPa', value.pressureUnit).toFixed(4)).toString()
        : value.smys,
    });
  };

  const setSegment = (index: number, patch: Partial<PipelineSegmentForm>) => {
    onChange({
      ...value,
      segments: value.segments.map((segment, position) => (
        position === index ? { ...segment, ...patch } : segment
      )),
    });
  };

  const addSegment = () => {
    // A new stretch starts where the previous one ended, which is what the pipe
    // book says and saves retyping the same chainage twice.
    const previous = value.segments[value.segments.length - 1];
    const segment = emptySegmentForm(`Segment ${value.segments.length + 1}`);
    onChange({
      ...value,
      segments: [...value.segments, { ...segment, startM: previous?.endM ?? '' }],
    });
  };

  const removeSegment = (index: number) => {
    onChange({ ...value, segments: value.segments.filter((_, position) => position !== index) });
  };

  const cell = (
    field: keyof PipelineSegmentForm,
    index: number,
    segment: PipelineSegmentForm,
    label: string,
    placeholder: string,
  ) => (
    <Input
      data
      small
      type="number"
      step="any"
      min="0"
      disabled={disabled}
      value={segment[field] as string}
      placeholder={placeholder}
      aria-label={`${label} for ${segment.label || `segment ${index + 1}`}`}
      onChange={(event) => setSegment(index, { [field]: event.target.value } as Partial<PipelineSegmentForm>)}
    />
  );

  return (
    <div className="pipe-spec">
      <section className="pipe-spec__group">
        <header className="pipe-spec__group-head">
          <h4>Asset &amp; operations</h4>
          <p>What the line is and how it runs. Nothing here changes a B31G number.</p>
        </header>
        <div className="pipe-spec__grid">
          <Field label="Environment">
            {(props) => (
              <Select {...props} disabled={disabled} value={value.environment} onChange={(event) => set('environment', event.target.value)}>
                <option value="">Not recorded</option>
                {ENVIRONMENTS.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Product medium">
            {(props) => (
              <Select {...props} disabled={disabled} value={value.productMedium} onChange={(event) => set('productMedium', event.target.value)}>
                <option value="">Not recorded</option>
                {PRODUCTS.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Pipe length [km]">
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.lengthKm} placeholder="e.g. 150" onChange={(event) => set('lengthKm', event.target.value)} />
            )}
          </Field>
          <Field label="Location class">
            {(props) => (
              <Select {...props} disabled={disabled} value={value.locationClass} onChange={(event) => set('locationClass', event.target.value)}>
                <option value="">Not recorded</option>
                {LOCATION_CLASSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Installation year" hint="When the pipe was laid.">
            {(props) => (
              <Input {...props} data type="number" min="1900" max="2100" step="1" disabled={disabled} value={value.installationYear} placeholder="e.g. 1993" onChange={(event) => set('installationYear', event.target.value)} />
            )}
          </Field>
          <Field label="Commissioning year" hint="When it went into service. FFS measures consumed design life from this.">
            {(props) => (
              <Input {...props} data type="number" min="1900" max="2100" step="1" disabled={disabled} value={value.commissioningYear} placeholder="e.g. 1995" onChange={(event) => set('commissioningYear', event.target.value)} />
            )}
          </Field>
          <Field label="Design life [years]" hint="Remnant life is not reported above this.">
            {(props) => (
              <Input {...props} data type="number" min="0" step="any" disabled={disabled} value={value.designLifeYears} placeholder="e.g. 30" onChange={(event) => set('designLifeYears', event.target.value)} />
            )}
          </Field>
          <Field label="External coating">
            {(props) => (
              <Select {...props} disabled={disabled} value={value.externalCoating} onChange={(event) => set('externalCoating', event.target.value)}>
                <option value="">Not recorded</option>
                {COATINGS.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </section>

      <section className="pipe-spec__group">
        <header className="pipe-spec__group-head">
          <h4>Line default pipe</h4>
          <p>
            What the line is made of where nothing says otherwise. Every one of these reaches the B31G
            calculation; a stretch that differs goes in the register below.
          </p>
          <div className="pipe-spec__units">
            <label>
              <span>Size</span>
              <Select
                small
                disabled={disabled}
                value={value.diameterUnit}
                aria-label="Diameter and wall unit"
                onChange={(event) => onChange(reunitForm(value, { diameterUnit: event.target.value as LengthUnit }))}
              >
                <option value="mm">mm</option>
                <option value="in">inch</option>
              </Select>
            </label>
            <label>
              <span>Pressure</span>
              <Select
                small
                disabled={disabled}
                value={value.pressureUnit}
                aria-label="Pressure and stress unit"
                onChange={(event) => onChange(reunitForm(value, { pressureUnit: event.target.value as PressureUnit }))}
              >
                <option value="MPa">MPa</option>
                <option value="bar">bar</option>
                <option value="psi">psi</option>
              </Select>
            </label>
          </div>
        </header>
        <div className="pipe-spec__grid">
          <Field label={`Outer diameter [${value.diameterUnit}]`}>
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.outerDiameter} placeholder={value.diameterUnit === 'in' ? 'e.g. 20' : 'e.g. 508'} onChange={(event) => set('outerDiameter', event.target.value)} />
            )}
          </Field>
          <Field label={`Nominal wall [${value.diameterUnit}]`}>
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.nominalWallThickness} placeholder={value.diameterUnit === 'in' ? 'e.g. 0.5' : 'e.g. 12.7'} onChange={(event) => set('nominalWallThickness', event.target.value)} />
            )}
          </Field>
          <Field label="Material grade">
            {(props) => (
              <Select {...props} disabled={disabled} value={value.materialGrade} onChange={(event) => setGrade(event.target.value)}>
                <option value="">Not recorded</option>
                {GRADES.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            )}
          </Field>
          <Field label={`SMYS [${value.pressureUnit}]`} hint="Filled in from API 5L when a grade is picked and this is blank.">
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.smys} placeholder="e.g. 358.5" onChange={(event) => set('smys', event.target.value)} />
            )}
          </Field>
          <Field label="Design factor" hint="0 to 1. Sets the derived safety factor 1/F.">
            {(props) => (
              <Input {...props} data type="number" step="0.01" min="0" max="1" disabled={disabled} value={value.designFactor} placeholder="e.g. 0.72" onChange={(event) => set('designFactor', event.target.value)} />
            )}
          </Field>
          <Field label="Seam type">
            {(props) => (
              <Select {...props} disabled={disabled} value={value.seamType} onChange={(event) => set('seamType', event.target.value)}>
                <option value="">Not recorded</option>
                {SEAM_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </section>

      <section className="pipe-spec__group">
        <header className="pipe-spec__group-head">
          <h4>Pressures &amp; code inputs</h4>
          <p>
            All in {value.pressureUnit}. FFS compares the pressure basis you select there with the safe
            pressure it calculates, so these are recorded separately rather than collapsed into one number.
          </p>
        </header>
        <div className="pipe-spec__grid">
          <Field label={`MAOP [${value.pressureUnit}]`}>
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.maop} placeholder="e.g. 8.3" onChange={(event) => set('maop', event.target.value)} />
            )}
          </Field>
          <Field label={`Design pressure [${value.pressureUnit}]`}>
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.designPressure} placeholder="e.g. 10.0" onChange={(event) => set('designPressure', event.target.value)} />
            )}
          </Field>
          <Field label={`Operating pressure [${value.pressureUnit}]`}>
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.operatingPressure} placeholder="e.g. 9.46" onChange={(event) => set('operatingPressure', event.target.value)} />
            )}
          </Field>
          <Field
            label={`Internal design pressure [${value.pressureUnit}]`}
            hint="The P of ASME B31.4 para. 403.2.1."
          >
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" disabled={disabled} value={value.internalDesignPressure} placeholder="e.g. 10.0" onChange={(event) => set('internalDesignPressure', event.target.value)} />
            )}
          </Field>
          <Field label="Weld joint factor E" hint="B31.4 Table 403.2.1-1. 1.00 for seamless, ERW and electric flash welded.">
            {(props) => (
              <Select {...props} disabled={disabled} value={value.weldJointFactor} onChange={(event) => set('weldJointFactor', event.target.value)}>
                <option value="">Not recorded</option>
                <option value="1">1.00 — seamless, ERW, electric flash welded</option>
                <option value="0.8">0.80 — electric fusion welded</option>
                <option value="0.6">0.60 — furnace butt welded, continuous welded</option>
              </Select>
            )}
          </Field>
          <Field label="Yield-to-tensile ratio" hint="Above 0.93, B31.4 para. 451.6.2.2(b) asks for an engineering analysis.">
            {(props) => (
              <Input {...props} data type="number" step="any" min="0" max="1" disabled={disabled} value={value.yieldToTensileRatio} placeholder="e.g. 0.88" onChange={(event) => set('yieldToTensileRatio', event.target.value)} />
            )}
          </Field>
        </div>
      </section>

      <section className="pipe-spec__group">
        <header className="pipe-spec__group-head">
          <h4>Pipe register</h4>
          <p>
            One row per stretch of uniform pipe, bounded on odometer metres from the launcher. Leave this
            empty for a line of one size. Fill it in where the line steps — 20 in to 24 in at a reducer, X52
            to X60 across a replacement spool — and FFS pre-fills each assessed section from the stretch it
            falls in. Blank cells mean "as the line default above".
          </p>
          <div className="pipe-spec__units">
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={disabled}
              startIcon={<FiPlus aria-hidden="true" />}
              onClick={addSegment}
            >
              Add stretch
            </Button>
          </div>
        </header>

        {value.segments.length === 0 ? (
          <p className="pipe-spec__empty">
            <FiInfo aria-hidden="true" />
            No stretch recorded. The whole line is assessed as {value.outerDiameter || '—'} {value.diameterUnit} pipe.
          </p>
        ) : (
          <div className="ds-table-wrap pipe-spec__register">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Stretch</th>
                  <th>Start [m]</th>
                  <th>End [m]</th>
                  <th>OD [{value.diameterUnit}]</th>
                  <th>Wall [{value.diameterUnit}]</th>
                  <th>SMYS [{value.pressureUnit}]</th>
                  <th>Design factor</th>
                  <th>Grade</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {value.segments.map((segment, index) => (
                  <tr key={segment.key}>
                    <td>
                      <Input
                        small
                        type="text"
                        disabled={disabled}
                        value={segment.label}
                        aria-label={`Name for segment ${index + 1}`}
                        placeholder={`Segment ${index + 1}`}
                        onChange={(event) => setSegment(index, { label: event.target.value })}
                      />
                    </td>
                    <td>{cell('startM', index, segment, 'Start metre', 'start')}</td>
                    <td>{cell('endM', index, segment, 'End metre', 'end')}</td>
                    <td>{cell('outerDiameter', index, segment, 'Outer diameter', value.outerDiameter || 'line')}</td>
                    <td>{cell('nominalWallThickness', index, segment, 'Nominal wall', value.nominalWallThickness || 'line')}</td>
                    <td>{cell('smys', index, segment, 'SMYS', value.smys || 'line')}</td>
                    <td>{cell('designFactor', index, segment, 'Design factor', value.designFactor || 'line')}</td>
                    <td>
                      <Select
                        small
                        disabled={disabled}
                        value={segment.materialGrade}
                        aria-label={`Material grade for segment ${index + 1}`}
                        onChange={(event) => {
                          const suggested = smysForGrade(event.target.value);
                          setSegment(index, {
                            materialGrade: event.target.value,
                            smys: segment.smys.trim() === '' && suggested !== null
                              ? Number(convertPressure(suggested, 'MPa', value.pressureUnit).toFixed(4)).toString()
                              : segment.smys,
                          });
                        }}
                      >
                        <option value="">Line</option>
                        {GRADES.map((option) => <option key={option} value={option}>{option}</option>)}
                      </Select>
                    </td>
                    <td>
                      <Button
                        size="xs"
                        variant="ghost"
                        type="button"
                        disabled={disabled}
                        aria-label={`Remove segment ${index + 1}`}
                        onClick={() => removeSegment(index)}
                        startIcon={<FiTrash2 aria-hidden="true" />}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {problems.length > 0 && (
          <ul className="pipe-spec__problems" role="alert">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}
      </section>

      <section className="pipe-spec__group">
        <Field label="Notes" hint="Anything about the line record a later assessment should read.">
          {(props) => (
            <Textarea
              {...props}
              disabled={disabled}
              value={value.notes}
              rows={2}
              placeholder="e.g. 24 in section replaced 2014 under WO-1182; original pipe book missing for KP 0–3."
              onChange={(event) => set('notes', event.target.value)}
            />
          )}
        </Field>
      </section>
    </div>
  );
}
