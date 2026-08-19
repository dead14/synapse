/**
 * Development-only harness for the pipeline dossier form.
 *
 * The real editors sit behind a session (the alignment intake) or behind the
 * register API (`/pipelines`), which makes iterating on the layout of a form
 * this size expensive. This page renders the same component against local
 * state, so the grouped grid, the register table and the dark theme can be
 * worked on without a backend.
 *
 * Mounted behind `import.meta.env.DEV`, alongside `/tolerances-preview`.
 */

import { useMemo, useState } from 'react';

import PipelineSpecFields from '../components/pipeline/PipelineSpecFields.tsx';
import {
  EMPTY_PIPELINE_SPEC_FORM,
  formToSpecification,
  pipelineSpecFormProblems,
  nextSegmentKey,
  type PipelineSpecForm,
} from '../domain/pipelineSpecForm.ts';

/** A line that steps from 20 in to 24 in, which is the case this form exists for. */
const SEEDED: PipelineSpecForm = {
  ...EMPTY_PIPELINE_SPEC_FORM,
  environment: 'Onshore',
  productMedium: 'Natural Gas (Dry)',
  lengthKm: '48.6',
  locationClass: 'Class 2',
  installationYear: '1993',
  commissioningYear: '1995',
  designLifeYears: '30',
  outerDiameter: '508',
  nominalWallThickness: '12.7',
  smys: '358.5',
  designFactor: '0.72',
  materialGrade: 'API 5L X52',
  seamType: 'ERW',
  externalCoating: '3LPE',
  maop: '8.3',
  designPressure: '10',
  operatingPressure: '7.9',
  internalDesignPressure: '10',
  weldJointFactor: '1',
  yieldToTensileRatio: '0.88',
  notes: '',
  segments: [
    {
      key: nextSegmentKey(),
      label: '20 in mainline',
      startM: '0',
      endM: '31200',
      outerDiameter: '',
      nominalWallThickness: '',
      smys: '',
      designFactor: '',
      materialGrade: '',
      seamType: '',
    },
    {
      key: nextSegmentKey(),
      label: '24 in after reducer',
      startM: '31200',
      endM: '48600',
      outerDiameter: '610',
      nominalWallThickness: '14.3',
      smys: '413.7',
      designFactor: '0.6',
      materialGrade: 'API 5L X60',
      seamType: '',
    },
  ],
};

export default function PipelineSpecPreviewPage() {
  const [form, setForm] = useState<PipelineSpecForm>(SEEDED);
  const problems = useMemo(() => pipelineSpecFormProblems(form), [form]);

  return (
    <div className="syn-page syn-ui-kit" style={{ padding: '1.5rem' }}>
      <div className="syn-page__header">
        <div>
          <p className="syn-eyebrow">Preview</p>
          <h1 className="syn-page__title">Pipeline dossier form</h1>
          <p className="syn-page__subtitle">
            The same component the alignment intake and the pipeline register use.
          </p>
        </div>
      </div>

      <div className="pipeline-register__detail">
        <PipelineSpecFields value={form} onChange={setForm} problems={problems} />
      </div>

      <details style={{ marginTop: '1rem' }}>
        <summary className="ds-eyebrow">Canonical record</summary>
        <pre className="ds-data" style={{ fontSize: '0.7rem', overflowX: 'auto' }}>
          {JSON.stringify(formToSpecification(form), null, 2)}
        </pre>
      </details>
    </div>
  );
}
