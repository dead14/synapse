import assert from 'node:assert/strict';
import test from 'node:test';

import { formatIngestionImportError } from '../src/domain/ingestionError.ts';

test('explains an unavailable ingestion queue without blaming the uploaded file', () => {
  assert.equal(
    formatIngestionImportError({
      code: 'INGESTION_QUEUE_UNAVAILABLE',
      message: 'Ingestion queue is unavailable',
    }),
    'Import service is temporarily unavailable. Please retry shortly.',
  );
});

test('shows configuration errors returned by the ingestion API', () => {
  assert.equal(
    formatIngestionImportError({
      code: 'ORGANIZATION_LIMIT_REACHED',
      message: 'Organization is inactive or its pipeline limit has been reached.',
    }),
    'Organization is inactive or its pipeline limit has been reached.',
  );
});

test('keeps file-validation guidance for unknown import failures', () => {
  assert.equal(
    formatIngestionImportError(new Error('Unexpected response')),
    'Failed to import the ILI file. Check the format, year, vendor, and headers.\n\nDetail: Unexpected response',
  );
});
