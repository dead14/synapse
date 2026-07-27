const test = require('node:test');
const assert = require('node:assert/strict');

const {
    queueUnavailableError,
    toIngestionUploadErrorResponse,
} = require('../src/modules/ingestion/ingestionErrors');

test('only a queue failure is returned as ingestion queue unavailable', () => {
    const response = toIngestionUploadErrorResponse(queueUnavailableError(new Error('Redis offline')));

    assert.deepEqual(response, {
        status: 503,
        body: {
            error: 'Ingestion queue is unavailable',
            code: 'INGESTION_QUEUE_UNAVAILABLE',
        },
    });
});

test('preparation failures are not mislabeled as an ingestion queue outage', () => {
    const response = toIngestionUploadErrorResponse(new Error('Object storage rejected the upload'));

    assert.deepEqual(response, {
        status: 500,
        body: {
            error: 'Failed to prepare ILI ingestion',
            code: 'INGESTION_PREPARATION_FAILED',
        },
    });
});

test('known ingestion configuration errors retain their actionable message', () => {
    const error = new Error('Organization is inactive or its pipeline limit has been reached.');
    error.code = 'ORGANIZATION_LIMIT_REACHED';

    const response = toIngestionUploadErrorResponse(error);

    assert.deepEqual(response, {
        status: 409,
        body: {
            error: error.message,
            code: 'ORGANIZATION_LIMIT_REACHED',
        },
    });
});
