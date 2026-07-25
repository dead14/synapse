const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildReusableAlignmentJobResponse,
} = require('../src/modules/alignment/alignmentExecution');
const {
    MAX_ALIGNMENT_RESULT_PAGE_SIZE,
    parseAlignmentResultPageQuery,
} = require('../src/modules/alignment/alignmentResultPaging');

test('completed reusable job response is compact and includes only audit metadata', () => {
    const audit = { isConserved: true };
    const response = buildReusableAlignmentJobResponse({
        job_id: 'job-1',
        state: 'completed',
        progress: 100,
        result_json: {
            comparison: Array.from({ length: 100 }, (_, index) => ({ index })),
            groups: { audit },
        },
    });

    assert.deepEqual(response, {
        jobId: 'job-1',
        state: 'completed',
        progress: 100,
        groups: { audit },
    });
    assert.equal('comparison' in response, false);
});

test('active reusable job response exposes its current progress', () => {
    assert.deepEqual(buildReusableAlignmentJobResponse({
        job_id: 'job-2',
        state: 'active',
        progress: 20,
        result_json: null,
    }), {
        jobId: 'job-2',
        state: 'active',
        progress: 20,
    });
});

test('result page query supports one bounded 20k row response', () => {
    assert.equal(MAX_ALIGNMENT_RESULT_PAGE_SIZE, 20_000);
    assert.deepEqual(parseAlignmentResultPageQuery({ limit: '20000', cursor: '5000' }), {
        limit: 20_000,
        after: 5_000,
    });
    assert.throws(
        () => parseAlignmentResultPageQuery({ limit: '20001' }),
        /between 1 and 20000/,
    );
});
