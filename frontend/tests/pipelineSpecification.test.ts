import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_PIPELINE_SPECIFICATION,
  normalizePipelineSpecification,
  registeredDiameters,
  sectionPipeFromRegister,
  segmentForRange,
  smysForGrade,
  type PipelineSegment,
} from '../src/domain/pipelineSpecification.ts';
import {
  EMPTY_PIPELINE_SPEC_FORM,
  formToSpecification,
  pipelineSpecFormProblems,
  specificationToForm,
  reunitForm,
} from '../src/domain/pipelineSpecForm.ts';
import { pipelineExportFields } from '../src/domain/pipelineExport.ts';

function segment(partial: Partial<PipelineSegment>): PipelineSegment {
  return {
    label: 'stretch',
    startM: null,
    endM: null,
    outerDiameterMm: null,
    nominalWallThicknessMm: null,
    smysMpa: null,
    designFactor: null,
    materialGrade: null,
    seamType: null,
    ...partial,
  };
}

test('a section adopts the registered stretch it overlaps most, not the first one it touches', () => {
  const segments = [
    segment({ label: '20 in', startM: 0, endM: 12_000, outerDiameterMm: 508 }),
    segment({ label: '24 in', startM: 12_000, endM: 30_000, outerDiameterMm: 610 }),
  ];

  // A section bounded on girth welds will not agree with the pipe book to the
  // metre; it straddles the reducer by 40 m and still belongs to the 24 in run.
  const straddling = segmentForRange(segments, { startM: 11_960, endM: 18_000 });
  assert.equal(straddling?.label, '24 in');

  const early = segmentForRange(segments, { startM: 200, endM: 4_000 });
  assert.equal(early?.label, '20 in');
});

test('a single-feature section still lands in the stretch that contains it', () => {
  const segments = [
    segment({ label: 'upstream', startM: 0, endM: 5_000 }),
    segment({ label: 'downstream', startM: 5_000, endM: 9_000 }),
  ];
  assert.equal(segmentForRange(segments, { startM: 6_400, endM: 6_400 })?.label, 'downstream');
});

test('a section outside every registered stretch takes the line default', () => {
  const segments = [segment({ label: 'mid', startM: 4_000, endM: 6_000 })];
  assert.equal(segmentForRange(segments, { startM: 20_000, endM: 21_000 }), null);
});

test('an open-ended stretch reaches the end of the line', () => {
  const segments = [segment({ label: 'tail', startM: 30_000, endM: null })];
  assert.equal(segmentForRange(segments, { startM: 44_000, endM: 51_000 })?.label, 'tail');
});

test('only what differs from the line is reported as a section override', () => {
  const specification = {
    ...EMPTY_PIPELINE_SPECIFICATION,
    outerDiameterMm: 508,
    smysMpa: 358.5,
    segments: [
      // Restates the line diameter and steps the grade up.
      segment({ label: 'spool', startM: 0, endM: 900, outerDiameterMm: 508, smysMpa: 413.7 }),
    ],
  };

  const resolved = sectionPipeFromRegister(specification, { startM: 100, endM: 800 });
  assert.equal(resolved.segment?.label, 'spool');
  assert.equal(resolved.outerDiameterMm, null, 'a restated line diameter is not an override');
  assert.equal(resolved.smysMpa, 413.7);
});

test('the register names every diameter the line is built from', () => {
  const specification = {
    ...EMPTY_PIPELINE_SPECIFICATION,
    outerDiameterMm: 508,
    segments: [
      segment({ outerDiameterMm: 610 }),
      segment({ outerDiameterMm: 508 }),
      segment({ outerDiameterMm: null }),
    ],
  };
  assert.deepEqual(registeredDiameters(specification), [508, 610]);
});

test('the form converts to the canonical record whatever unit was shown', () => {
  const form = {
    ...EMPTY_PIPELINE_SPEC_FORM,
    diameterUnit: 'in' as const,
    pressureUnit: 'psi' as const,
    outerDiameter: '20',
    nominalWallThickness: '0.5',
    smys: '52000',
    maop: '1200',
  };

  const specification = formToSpecification(form);
  assert.equal(specification.outerDiameterMm, 508);
  assert.ok(Math.abs((specification.nominalWallThicknessMm ?? 0) - 12.7) < 1e-9);
  assert.ok(Math.abs((specification.smysMpa ?? 0) - 358.527364) < 1e-4);
  assert.ok(Math.abs((specification.maopMpa ?? 0) - 8.2737084) < 1e-6);
});

test('a blank optional field stays blank instead of becoming a typed zero', () => {
  const specification = formToSpecification(EMPTY_PIPELINE_SPEC_FORM);
  assert.equal(specification.outerDiameterMm, null);
  assert.equal(specification.designFactor, null);
  assert.equal(specification.maopMpa, null);
  assert.deepEqual(specification.segments, []);
});

test('switching the shown unit relabels the typed figures and leaves blanks alone', () => {
  const form = {
    ...EMPTY_PIPELINE_SPEC_FORM,
    outerDiameter: '508',
    nominalWallThickness: '',
    segments: [{
      key: 'segment-1',
      label: 'a',
      startM: '0',
      endM: '1000',
      outerDiameter: '610',
      nominalWallThickness: '',
      smys: '',
      designFactor: '',
      materialGrade: '',
      seamType: '',
    }],
  };

  const inches = reunitForm(form, { diameterUnit: 'in' });
  assert.equal(inches.outerDiameter, '20');
  assert.equal(inches.nominalWallThickness, '');
  assert.equal(inches.segments[0].outerDiameter, '24.015748');
  // The chainage is metres in both, and must not be re-scaled with the pipe.
  assert.equal(inches.segments[0].endM, '1000');
});

test('a round trip through the form keeps the stored record intact', () => {
  const specification = {
    ...EMPTY_PIPELINE_SPECIFICATION,
    outerDiameterMm: 508,
    nominalWallThicknessMm: 12.7,
    smysMpa: 358.5,
    designFactor: 0.72,
    maopMpa: 8.3,
    commissioningYear: 1995,
    segments: [segment({ label: '24 in', startM: 12_000, endM: 30_000, outerDiameterMm: 610 })],
  };

  const restored = formToSpecification(specificationToForm(specification));
  assert.equal(restored.outerDiameterMm, 508);
  assert.equal(restored.nominalWallThicknessMm, 12.7);
  assert.equal(restored.designFactor, 0.72);
  assert.equal(restored.commissioningYear, 1995);
  assert.equal(restored.segments[0].outerDiameterMm, 610);
  assert.equal(restored.segments[0].endM, 30_000);
});

test('a transposed diameter and wall is reported rather than assessed', () => {
  const problems = pipelineSpecFormProblems({
    ...EMPTY_PIPELINE_SPEC_FORM,
    outerDiameter: '12.7',
    nominalWallThickness: '508',
  });
  assert.ok(problems.some((problem) => problem.includes('no bore')));
});

test('a design factor outside 0 to 1 is refused', () => {
  const problems = pipelineSpecFormProblems({ ...EMPTY_PIPELINE_SPEC_FORM, designFactor: '1.4' });
  assert.ok(problems.some((problem) => problem.includes('design factor')));
});

test('a stretch that ends before it starts is refused', () => {
  const problems = pipelineSpecFormProblems({
    ...EMPTY_PIPELINE_SPEC_FORM,
    segments: [{
      key: 'segment-1',
      label: '24 in',
      startM: '9000',
      endM: '4000',
      outerDiameter: '',
      nominalWallThickness: '',
      smys: '',
      designFactor: '',
      materialGrade: '',
      seamType: '',
    }],
  });
  assert.ok(problems.some((problem) => problem.includes('must end after it starts')));
});

test('API 5L grades carry their published SMYS', () => {
  assert.equal(smysForGrade('API 5L X52'), 358.5);
  assert.equal(smysForGrade('API 5L X60'), 413.7);
  assert.equal(smysForGrade('Something else'), null);
  assert.equal(smysForGrade(null), null);
});

test('the export flattens the register into numbered stretch rows', () => {
  const fields = pipelineExportFields({
    ...EMPTY_PIPELINE_SPECIFICATION,
    outerDiameterMm: 508,
    segments: [
      segment({ label: '20 in', startM: 0, endM: 12_000, outerDiameterMm: 508 }),
      segment({ label: '24 in', startM: 12_000, endM: null, outerDiameterMm: 610 }),
    ],
  });

  assert.equal(fields.segmentCount, 2);
  assert.equal(fields.segment1Label, '20 in');
  assert.equal(fields.segment1Range, '0 m – 12000 m');
  assert.equal(fields.segment2Label, '24 in');
  assert.equal(fields.segment2Range, '12000 m – end');
  assert.equal(fields.segment2OuterDiameterMm, 610);
});

test('the API payload is forced to shape rather than trusted', () => {
  const specification = normalizePipelineSpecification({
    outerDiameterMm: '508',
    designFactor: 'not a number',
    materialGrade: '  API 5L X52  ',
    segments: [{ label: '', startM: '0', endM: '900', outerDiameterMm: 610 }],
  });

  assert.equal(specification.outerDiameterMm, 508);
  assert.equal(specification.designFactor, null);
  assert.equal(specification.materialGrade, 'API 5L X52');
  assert.equal(specification.segments[0].label, 'Segment 1');
  assert.equal(specification.segments[0].endM, 900);
});
