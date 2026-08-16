/**
 * Step 1 — Line and evidence.
 *
 * Six fields. Which line, what it carries, the filed assessment the measured
 * damage comes from, and any interval a regulator has already capped. Diameter
 * and pressure are read from that assessment rather than typed, because a number
 * copied by hand from another screen is a number with an extra way to be wrong.
 */

import { FiAlertTriangle } from 'react-icons/fi';
import { Link } from 'react-router-dom';

import { Callout } from '../../../components/ds';
import { FLUID_OPTIONS } from '../../../lib/rbi/catalogues';
import {
  DerivedValue,
  FieldGrid,
  FullWidth,
  NumberField,
  PickField,
  StepPanel,
  TextField,
} from '../RbiControls';
import type { StepProps } from '../stepProps';
import type { FfsSessionListItem } from '../../../lib/ffs/sessions';

interface Props extends StepProps {
  ffsSessions: FfsSessionListItem[];
  ffsLoading: boolean;
  evidenceUnreadable: boolean;
  onAttach: (ffsSessionId: string) => void;
  geometry: { outerDiameterMm: number; operatingPressureMpa: number } | null;
}

export default function StepLine({
  record,
  update,
  assessment,
  ffsSessions,
  ffsLoading,
  evidenceUnreadable,
  onAttach,
  geometry,
}: Props) {
  const set = <K extends keyof typeof record>(key: K, value: (typeof record)[K]) => {
    update((current) => ({ ...current, [key]: value }));
  };

  return (
    <>
      <StepPanel
        title="Evidence"
        blurb="The measured half of the probability. Everything this assessment says about metal loss comes
          from a fitness-for-service assessment that has already been run and filed."
      >
        <FieldGrid>
          <FullWidth>
            <label className="ds-field">
              <span className="ds-field__label">Filed fitness-for-service assessment</span>
              <select
                className="ds-select"
                value={record.ffsSessionId ?? ''}
                onChange={(event) => onAttach(event.target.value)}
              >
                <option value="">Not attached</option>
                {ffsSessions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {item.featureCount.toLocaleString()} features
                  </option>
                ))}
              </select>
              <span className="ds-field__hint">
                Without it there is nothing measured to rank, and this tool will not invent it.
              </span>
            </label>
          </FullWidth>
        </FieldGrid>

        {ffsLoading && <p className="rbi-check__hint">Reading the filed assessment…</p>}

        {!ffsLoading && ffsSessions.length === 0 && (
          <Callout tone="warning" title="No assessment has been filed yet">
            Run one from the <Link to="/alignment-history">alignment registry</Link> first.
          </Callout>
        )}

        {evidenceUnreadable && (
          <Callout tone="danger" icon={<FiAlertTriangle />} title="Evidence unavailable">
            The attached assessment could not be read. This record is still editable, but nothing can be
            ranked until it is restored or another one is attached.
          </Callout>
        )}

        {assessment && geometry && (
          <FieldGrid columns={3}>
            <DerivedValue
              label="Assessed features"
              value={assessment.totals.features.toLocaleString()}
              source={assessment.totals.unassessed > 0
                ? `${assessment.totals.unassessed.toLocaleString()} anomalies carried no B31G result and are grouped separately.`
                : 'Every anomaly in the run carried a B31G result.'}
            />
            <DerivedValue
              label="Outer diameter"
              value={`${geometry.outerDiameterMm} mm`}
              source="Read from the filed assessment. Sets the release scale."
            />
            <DerivedValue
              label="Operating pressure"
              value={`${geometry.operatingPressureMpa} MPa`}
              source="Read from the filed assessment. Sets the release scale."
            />
          </FieldGrid>
        )}
      </StepPanel>

      <StepPanel
        title="Line"
        blurb="What is being assessed, and what it carries."
      >
        <FieldGrid>
          <TextField
            label="Assessment title"
            value={record.title}
            onChange={(value) => set('title', value)}
            placeholder="e.g. Trunkline A — 2026 screening"
          />
          <TextField
            label="Line or segment"
            value={record.segment}
            onChange={(value) => set('segment', value)}
            placeholder="e.g. CPA to Terminal, 20 in"
          />
          <PickField
            label="Fluid"
            hint="Sets the hazard side of the safety consequence."
            value={record.fluid}
            options={FLUID_OPTIONS}
            onChange={(value) => set('fluid', value)}
          />
          <NumberField
            label="Regulatory maximum interval"
            unit="years"
            hint="A limit already imposed by a regulator or a company standard. It caps every interval this
              assessment derives. Leave blank if none applies."
            value={record.maxIntervalYears}
            onChange={(value) => set('maxIntervalYears', value)}
            min={0}
          />
          <FullWidth>
            <label className="rbi-check">
              <input
                type="checkbox"
                checked={record.toxic}
                onChange={(event) => set('toxic', event.target.checked)}
              />
              <span>
                <span className="rbi-check__label">A release would be toxic</span>
                <span className="rbi-check__hint">
                  It injures without needing to ignite, and reaches further than a flammable release. A toxic
                  hazard is never scored below category 4, and the responder is assumed closer to it.
                </span>
              </span>
            </label>
          </FullWidth>
        </FieldGrid>
      </StepPanel>
    </>
  );
}
