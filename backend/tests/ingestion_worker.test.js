const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    buildIngestionArguments,
    ingestionWorkerCwd,
} = require('../src/workers/ingestionCommand');
const { resolveIngestionExit } = require('../src/workers/ingestionOutcome');
const {
    ingestionLimiter,
    isUnrecoverableIngestionError,
} = require('../src/workers/ingestionPolicy');

test('ingestion worker passes the stored object key to the Python importer', () => {
    const argumentsForImporter = buildIngestionArguments({
        inputPath: 'C:/temp/2021.xlsx',
        pipelineName: 'North Line',
        surveyYear: 2021,
        vendor: 'Vendor A',
        organizationId: 12,
        userId: 34,
        sourceFile: '2021.xlsx',
        objectKey: 'ili/12/checksum-2021.xlsx',
    });

    assert.deepEqual(argumentsForImporter, [
        'src/python_engines/db_ingest.py',
        '--file', 'C:/temp/2021.xlsx',
        '--pipeline', 'North Line',
        '--year', '2021',
        '--vendor', 'Vendor A',
        '--organization-id', '12',
        '--user-id', '34',
        '--source-name', '2021.xlsx',
        '--source-object-key', 'ili/12/checksum-2021.xlsx',
    ]);
});

test('ingestion worker starts Python from the backend directory', () => {
    assert.equal(ingestionWorkerCwd(), path.resolve(__dirname, '..'));
});

test('ingestion worker returns the importer failure message instead of a generic exit code', () => {
    assert.throws(() => resolveIngestionExit({
        code: 1,
        errorOutput: '',
        output: 'JSON_OUTPUT:{"status":"error","message":"This source file is already imported."}',
    }), /already imported/i);
});

test('ingestion worker preserves a structured importer error code', () => {
    assert.throws(() => resolveIngestionExit({
        code: 1,
        errorOutput: '',
        output: 'JSON_OUTPUT:{"status":"error","code":"PARSER_DICTIONARY_UNAVAILABLE","message":"Dictionary missing"}',
    }), (error) => {
        assert.equal(error.code, 'PARSER_DICTIONARY_UNAVAILABLE');
        assert.equal(isUnrecoverableIngestionError(error), true);
        return true;
    });
});

test('ingestion throughput is concurrency-bound unless an explicit rate limit is configured', () => {
    assert.equal(ingestionLimiter({}), null);
    assert.equal(ingestionLimiter({ INGESTION_RATE_MAX: '0' }), null);
    assert.deepEqual(ingestionLimiter({
        INGESTION_RATE_MAX: '12',
        INGESTION_RATE_DURATION_MS: '30000',
    }), { max: 12, duration: 30000 });
});
