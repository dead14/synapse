const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveStage, serializeRegistryRow } = require('../src/modules/alignment/alignmentRegistry');

function row(overrides = {}) {
    return {
        id: 12,
        pipeline_id: 3,
        stored_pipeline_name: 'HU CPA',
        status: 'completed',
        started_at: '2026-05-01T09:00:00.000Z',
        completed_at: '2026-05-01T10:00:00.000Z',
        params_json: {
            algorithm: 'dtw_hungarian_onedirection',
            summaryData: {
                sessionName: 'HU CPA 20in',
                oldRun: { name: 'Rosen 2019', runId: 4 },
                newRun: { name: 'NDT 2024', runId: 9 },
            },
            resultSummary: { matchRate: 82.4, anomaliesFound: 1204 },
        },
        old_vendor: 'Rosen',
        old_survey_year: 2019,
        old_survey_date: '2019-06-01',
        new_vendor: 'NDT Global',
        new_survey_year: 2024,
        new_survey_date: '2024-07-14',
        new_row_count: 40112,
        run_old_id: 4,
        run_new_id: 9,
        completed_job_id: 'job-1',
        result_completed_at: '2026-05-01T10:00:00.000Z',
        reviewed_count: 120,
        selected_count: 18,
        ffs_session_id: null,
        ffs_created_at: null,
        ffs_feature_count: 0,
        ffs_summary: null,
        ffs_session_count: 0,
        ...overrides,
    };
}

test('a registry row carries both halves: the runs compared and what happened next', () => {
    const serialized = serializeRegistryRow(row());

    assert.equal(serialized.id, '12');
    assert.equal(serialized.pipelineName, 'HU CPA 20in');
    assert.equal(serialized.matchRate, 82.4);
    assert.equal(serialized.anomaliesFound, 1204);
    // Vendor and survey year come from the persisted survey run, which is what
    // the removed ILI-runs page used to be the only place to see.
    assert.equal(serialized.runs.new.vendor, 'NDT Global');
    assert.equal(serialized.runs.new.surveyYear, 2024);
    assert.equal(serialized.runs.new.rowCount, 40112);
    assert.equal(serialized.runs.old.vendor, 'Rosen');
    assert.equal(serialized.result.available, true);
    assert.deepEqual(serialized.review, { reviewedCount: 120, selectedCount: 18 });
    assert.equal(serialized.ffs, null);
    assert.equal(serialized.stage, 'released');
});

test('a session built before the run columns were populated still names its runs', () => {
    const serialized = serializeRegistryRow(row({
        old_vendor: null, old_survey_year: null, old_survey_date: null,
        new_vendor: null, new_survey_year: null, new_survey_date: null,
        run_old_id: null, run_new_id: null, new_row_count: null,
    }));

    assert.equal(serialized.runs.old.name, 'Rosen 2019');
    assert.equal(serialized.runs.new.name, 'NDT 2024');
    assert.equal(serialized.runs.new.rowCount, null);
});

test('a filed assessment is reported with the counts the table shows', () => {
    const serialized = serializeRegistryRow(row({
        ffs_session_id: 55,
        ffs_created_at: '2026-06-02T00:00:00.000Z',
        ffs_feature_count: 900,
        ffs_summary: { pass: 700, review: 188, fail: 12 },
        ffs_session_count: 2,
    }));

    assert.equal(serialized.ffs.sessionId, '55');
    assert.equal(serialized.ffs.featureCount, 900);
    assert.equal(serialized.ffs.sessionCount, 2);
    assert.equal(serialized.stage, 'assessed');
});

test('the stage is derived in one place, and a filed assessment outranks a release', () => {
    assert.equal(deriveStage({ status: 'in_progress', selectedCount: 0, ffsSessionId: null }), 'running');
    assert.equal(deriveStage({ status: 'failed', selectedCount: 0, ffsSessionId: null }), 'failed');
    // A completed alignment with no review is not blocked: FFS can assess every
    // anomaly it found.
    assert.equal(deriveStage({ status: 'completed', selectedCount: 0, ffsSessionId: null }), 'aligned');
    assert.equal(deriveStage({ status: 'completed', selectedCount: 4, ffsSessionId: null }), 'released');
    assert.equal(deriveStage({ status: 'completed', selectedCount: 4, ffsSessionId: '5' }), 'assessed');
});

test('a malformed row degrades to stated absence rather than to undefined', () => {
    const serialized = serializeRegistryRow({ id: 7, status: 'in_progress', params_json: 'not json' });

    assert.equal(serialized.pipelineName, 'Run 7');
    assert.equal(serialized.matchRate, null);
    assert.equal(serialized.anomaliesFound, 0);
    assert.equal(serialized.result.available, false);
    assert.equal(serialized.ffs, null);
    assert.equal(serialized.stage, 'running');
});

test('a JSON-encoded params column reads the same as an object one', () => {
    const object = serializeRegistryRow(row());
    const encoded = serializeRegistryRow(row({ params_json: JSON.stringify(row().params_json) }));

    assert.deepEqual(encoded, object);
});
