import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeInspectionPage,
  summarizeInspectionRegistry,
  validateInspectionImport,
} from '../src/domain/inspection.ts';

test('normalizes canonical inspection evidence without inventing provenance', () => {
  const page = normalizeInspectionPage({
    items: [{
      id: 4,
      pipelineId: 2,
      pipelineName: 'North Line',
      surveyYear: 2026,
      vendor: 'Vendor A',
      sourceFile: 'north.csv',
      uploadedAt: '2026-07-16T00:00:00.000Z',
      rowCount: 120,
      workflow: { stage: 'runcomp', alignmentSessionId: 44, downloadAvailable: true },
      provenance: {
        sourceSha256: 'a'.repeat(64),
        parserVersion: 'parser-v1',
        schemaVersion: 'schema-v1',
      },
      evidence: {
        status: 'review',
        sourceRows: 122,
        acceptedRows: 120,
        rejectedRows: 2,
        mappedColumns: 14,
        recognizedHeaderFields: 16,
        warningCount: 1,
      },
    }],
    nextCursor: '3',
  });

  assert.equal(page.items[0].evidence.rejectedRows, 2);
  assert.equal(page.items[0].provenance.sourceSha256, 'a'.repeat(64));
  assert.deepEqual(page.items[0].workflow, {
    stage: 'runcomp', alignmentSessionId: 44, downloadAvailable: true,
  });
  assert.equal(page.nextCursor, '3');

  const emptyProvenance = normalizeInspectionPage({ items: [{ id: 9 }] }).items[0].provenance;
  assert.deepEqual(emptyProvenance, {
    sourceSha256: null,
    parserVersion: null,
    schemaVersion: null,
  });
});

test('registry summary only aggregates measured non-negative values', () => {
  const page = normalizeInspectionPage({
    items: [
      { id: 1, pipelineId: 1, pipelineName: 'A', rowCount: 10, evidence: { status: 'ready', acceptedRows: 10, rejectedRows: 0 } },
      { id: 2, pipelineId: 1, pipelineName: 'A', rowCount: 9, evidence: { status: 'review', acceptedRows: 8, rejectedRows: 1 } },
      { id: 3, pipelineId: 2, pipelineName: 'B', rowCount: -5, evidence: { status: 'unknown', acceptedRows: 'NaN', rejectedRows: -3 } },
    ],
  });

  assert.deepEqual(summarizeInspectionRegistry(page.items), {
    runCount: 3,
    pipelineCount: 2,
    acceptedRows: 18,
    rejectedRows: 1,
    reviewCount: 1,
  });
});

test('import validation mirrors server limits and supported vendor files', () => {
  const valid = validateInspectionImport({
    pipelineName: 'North Line',
    vendor: 'Vendor A',
    surveyYear: '2026',
    file: { name: 'inspection.CSV', size: 1_024 },
  });
  assert.deepEqual(valid, { ok: true, year: 2026 });

  assert.match(validateInspectionImport({
    pipelineName: '', vendor: 'Vendor A', surveyYear: '2026', file: { name: 'a.csv', size: 1 },
  }).error || '', /Pipeline name/);
  assert.match(validateInspectionImport({
    pipelineName: 'A', vendor: 'Vendor A', surveyYear: '2026', file: { name: 'a.xls', size: 1 },
  }).error || '', /CSV or XLSX/);
  assert.match(validateInspectionImport({
    pipelineName: 'A', vendor: 'Vendor A', surveyYear: '2026', file: { name: 'a.xlsx', size: 26 * 1024 * 1024 },
  }).error || '', /25 MB/);
});
