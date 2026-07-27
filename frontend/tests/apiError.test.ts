import assert from 'node:assert/strict';
import test from 'node:test';

import { getErrorInfo } from '../src/utils/apiError.ts';

test('preserves a top-level API error code when the error is a string', () => {
  assert.deepEqual(
    getErrorInfo({
      error: 'Ingestion queue is unavailable',
      code: 'INGESTION_QUEUE_UNAVAILABLE',
    }, 'Request failed'),
    {
      message: 'Ingestion queue is unavailable',
      code: 'INGESTION_QUEUE_UNAVAILABLE',
    },
  );
});
