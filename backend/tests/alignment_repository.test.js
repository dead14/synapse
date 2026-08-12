const test = require('node:test');
const assert = require('node:assert/strict');

const {
    findOwnedSession,
    findLatestOwnedSession,
    listOwnedSessions,
    createOwnedSession,
    updateOwnedSessionConfig,
    markOwnedSessionCompleted,
    markOwnedSessionFailed,
    deleteOwnedSession,
    createAlignmentJob,
    findOwnedAlignmentExport,
    iterateOwnedAlignmentExportRows,
    listOwnedAlignmentResultPage,
    saveAlignmentJobRows,
} = require('../src/modules/alignment/alignmentRepository');

function recordingPool(result = { rows: [], rowCount: 0 }) {
    const calls = [];
    return {
        calls,
        async query(text, values) {
            calls.push({ text, values });
            return result;
        },
    };
}

test('findOwnedSession scopes session through organization ownership', async () => {
    const pool = recordingPool({ rows: [{ id: 7 }], rowCount: 1 });

    const row = await findOwnedSession(pool, 7, 22);

    assert.equal(row.id, 7);
    assert.match(pool.calls[0].text, /LEFT JOIN pipelines p/i);
    assert.match(pool.calls[0].text, /COALESCE\(s\.organization_id, p\.organization_id\) = \$2/i);
    assert.deepEqual(pool.calls[0].values, [7, 22]);
});

test('createOwnedSession writes server-derived organization and creator', async () => {
    const pool = recordingPool({ rows: [{ id: 9 }], rowCount: 1 });

    const row = await createOwnedSession(pool, { hello: 'world' }, { id: 4, orgId: 22 });

    assert.equal(row.id, 9);
    assert.match(pool.calls[0].text, /organization_id, created_by/i);
    assert.deepEqual(pool.calls[0].values.slice(0, 2), [22, 4]);
});

test('updateOwnedSessionConfig cannot update a session outside the organization', async () => {
    const pool = recordingPool({ rows: [], rowCount: 0 });

    const updated = await updateOwnedSessionConfig(pool, 7, 22, { hello: 'world' });

    assert.equal(updated, null);
    assert.match(pool.calls[0].text, /COALESCE\(s\.organization_id, p\.organization_id\) = \$3/i);
    // Trailing values are the derived run references; a config with no
    // summaryData contributes none and must not clear the stored ones.
    assert.deepEqual(pool.calls[0].values.slice(1, 6), [7, 22, null, null, null]);
});

test('updateOwnedSessionConfig keeps the fields the server writes for itself', async () => {
    const pool = recordingPool({ rows: [{ id: 7, status: 'completed', revision: '43' }], rowCount: 1 });

    await updateOwnedSessionConfig(pool, 7, 22, { hello: 'world' });

    // A wizard snapshot never carries resultSummary, so overwriting the column
    // with it erased the run summary the FFS handoff gate reads — and the
    // reviewer's interventions and sections with it.
    assert.deepEqual(pool.calls[0].values[6], [
        'resultSummary', 'failureReason', 'interventions', 'sections', 'pipelineRoute',
    ]);
    assert.match(pool.calls[0].text, /jsonb_each\(COALESCE\(s\.params_json::jsonb/i);
    assert.match(pool.calls[0].text, /entry\.key = ANY\(\$7::text\[\]\)/i);
    // The snapshot still wins for every key it defines.
    assert.match(pool.calls[0].text, /\|\| \$1::jsonb/);
});

test('updateOwnedSessionConfig records the run pair the session references', async () => {
    const pool = recordingPool({ rows: [{ id: 7, status: 'in_progress', revision: '43' }], rowCount: 1 });

    await updateOwnedSessionConfig(pool, 7, 22, {
        summaryData: { oldRun: { runId: 11 }, newRun: { runId: 12 } },
    });

    assert.deepEqual(pool.calls[0].values.slice(4, 6), [11, 12]);
    assert.match(pool.calls[0].text, /run_old_id = COALESCE\(\$5::integer, s\.run_old_id\)/i);
});

test('updateOwnedSessionConfig takes the chain ends when a session holds run pairs', async () => {
    const pool = recordingPool({ rows: [{ id: 7, status: 'in_progress', revision: '43' }], rowCount: 1 });

    await updateOwnedSessionConfig(pool, 7, 22, {
        summaryData: {
            runPairs: [
                { oldRun: { runId: 5 }, newRun: { runId: 6 } },
                { oldRun: { runId: 6 }, newRun: { runId: 9 } },
            ],
        },
    });

    assert.deepEqual(pool.calls[0].values.slice(4, 6), [5, 9]);
});

test('updateOwnedSessionConfig does not echo the full saved JSON payload', async () => {
    const pool = recordingPool({ rows: [{ id: 7, status: 'in_progress', revision: '43' }], rowCount: 1 });

    await updateOwnedSessionConfig(pool, 7, 22, { bulky: 'x'.repeat(10_000) });

    const returningClause = pool.calls[0].text.match(/RETURNING[\s\S]*$/i)?.[0] || '';
    assert.doesNotMatch(returningClause, /params_json/i);
});

test('findLatestOwnedSession never falls back outside the organization', async () => {
    const pool = recordingPool({ rows: [{ id: 8 }], rowCount: 1 });

    await findLatestOwnedSession(pool, 22, { requireData: true });

    assert.match(pool.calls[0].text, /COALESCE\(s\.organization_id, p\.organization_id\) = \$1/i);
    assert.match(pool.calls[0].text, /params_json IS NOT NULL/i);
    assert.deepEqual(pool.calls[0].values, [22]);
});

test('listOwnedSessions is tenant scoped and ordered newest first', async () => {
    const pool = recordingPool({ rows: [], rowCount: 0 });

    await listOwnedSessions(pool, 22);

    assert.match(pool.calls[0].text, /COALESCE\(s\.organization_id, p\.organization_id\) = \$1/i);
    assert.match(pool.calls[0].text, /ORDER BY s\.started_at DESC/i);
});

test('completion persists status, timestamp, and result summary only for owner', async () => {
    const pool = recordingPool({ rows: [{ id: 7, status: 'completed' }], rowCount: 1 });

    const row = await markOwnedSessionCompleted(pool, 7, 22, { total: 5, matched: 4 });

    assert.equal(row.status, 'completed');
    assert.match(pool.calls[0].text, /completed_at = NOW\(\)/i);
    assert.match(pool.calls[0].text, /resultSummary/i);
    assert.match(pool.calls[0].text, /s\.params_json::jsonb/i);
    assert.match(pool.calls[0].text, /\)::json/i);
    assert.match(pool.calls[0].text, /COALESCE\(s\.organization_id, p\.organization_id\) = \$3/i);
});

test('failure persists a generic reason only for owner', async () => {
    const pool = recordingPool({ rows: [{ id: 7, status: 'failed' }], rowCount: 1 });

    const row = await markOwnedSessionFailed(pool, 7, 22, 'Alignment engine failed');

    assert.equal(row.status, 'failed');
    assert.match(pool.calls[0].text, /failureReason/i);
    assert.match(pool.calls[0].text, /s\.params_json::jsonb/i);
    assert.match(pool.calls[0].text, /\)::json/i);
    assert.doesNotMatch(pool.calls[0].text, /errorOutput|stderr/i);
});

test('deleteOwnedSession removes only an owned session and dependent records', async () => {
    const pool = recordingPool({ rows: [{ id: 7 }], rowCount: 1 });

    const deleted = await deleteOwnedSession(pool, 7, 22);

    assert.equal(deleted.id, 7);
    assert.match(pool.calls[0].text, /COALESCE\(s\.organization_id, p\.organization_id\) = \$2/i);
    assert.match(pool.calls[0].text, /UPDATE alignment_links/i);
    assert.match(pool.calls[0].text, /DELETE FROM alignment_results/i);
    assert.match(pool.calls[0].text, /DELETE FROM alignment_sessions/i);
    assert.deepEqual(pool.calls[0].values, [7, 22]);
});

test('alignment job persists engine and configuration metadata before execution', async () => {
    const pool = recordingPool({ rows: [{ job_id: 'job-1' }], rowCount: 1 });

    await createAlignmentJob(pool, {
        jobId: 'job-1',
        sessionId: 7,
        organizationId: 22,
        userId: 4,
        engineVersion: 'engine-v6',
        configFingerprint: 'config-sha256',
    });

    assert.match(pool.calls[0].text, /result_json/i);
    assert.deepEqual(JSON.parse(pool.calls[0].values[4]), {
        engineVersion: 'engine-v6',
        configFingerprint: 'config-sha256',
    });
});

test('alignment result page is tenant scoped and read as an indexed row range', async () => {
    const pool = recordingPool({
        rows: [
            { row: { id: 1 }, ordinal: 2 },
            { row: { id: 2 }, ordinal: 3 },
            { row: { id: 3 }, ordinal: 4 },
        ],
    });
    const page = await listOwnedAlignmentResultPage(pool, 8, 22, { limit: 2, after: 1 });
    assert.deepEqual(page.rows, [{ id: 1 }, { id: 2 }]);
    assert.equal(page.nextCursor, 3);
    assert.equal(pool.calls.length, 1, 'a page served from rows must not also run the legacy query');
    assert.match(pool.calls[0].text, /organization_id = \$2/i);
    // Paging must be a range scan over the stored rows, never a re-expansion of
    // the whole comparison array: that is what made every page cost O(all rows).
    assert.match(pool.calls[0].text, /alignment_job_rows/i);
    assert.doesNotMatch(pool.calls[0].text, /jsonb_array_elements/i);
    assert.deepEqual(pool.calls[0].values, [8, 22, 1, 3]);
});

test('alignment result page falls back to the stored JSON for pre-migration jobs', async () => {
    const responses = [
        { rows: [] },
        { rows: [{ row: { id: 9 }, ordinal: 1 }] },
    ];
    const calls = [];
    const pool = {
        async query(text, values) {
            calls.push({ text, values });
            return responses.shift() ?? { rows: [] };
        },
    };

    const page = await listOwnedAlignmentResultPage(pool, 8, 22, { limit: 2, after: 0 });

    assert.deepEqual(page.rows, [{ id: 9 }]);
    assert.equal(page.nextCursor, null);
    assert.equal(calls.length, 2);
    assert.match(calls[1].text, /jsonb_array_elements/i);
    assert.match(calls[1].text, /row_count IS NULL/i);
});

test('alignment export descriptor returns the tenant-owned completed row count', async () => {
    const pool = recordingPool({
        rows: [{ job_id: 'job-1', row_count: 500_000, rows_persisted: true }],
        rowCount: 1,
    });

    const descriptor = await findOwnedAlignmentExport(pool, 8, 22);

    assert.deepEqual(descriptor, { jobId: 'job-1', rowCount: 500_000, rowsPersisted: true });
    assert.match(pool.calls[0].text, /organization_id = \$2/i);
    // Persisted rows report their count from a column; only a legacy job still
    // measures the stored array.
    assert.match(pool.calls[0].text, /jsonb_array_length/i);
    assert.match(pool.calls[0].text, /j\.row_count/i);
    assert.deepEqual(pool.calls[0].values, [8, 22]);
});

test('completed alignment rows are stored one per row with a resolved sort distance', async () => {
    const calls = [];
    const client = {
        async query(text, values) {
            calls.push({ text, values });
            return { rows: [], rowCount: 0 };
        },
        release() {},
    };
    const pool = { connect: async () => client };

    const stored = await saveAlignmentJobRows(pool, 'job-1', [
        { 'Log Dist NEW (m)': '12.5' },
        { 'Log Dist NEW (m)': '-', 'Log Dist OLD (m)': '30' },
        { 'Log Dist NEW (m)': '-' },
    ]);

    assert.equal(stored, 3);
    const insert = calls.find((call) => /INSERT INTO alignment_job_rows/i.test(call.text));
    assert.ok(insert, 'rows must be inserted');
    // job_id, then (ordinal, sort_distance, row_json) per row.
    assert.equal(insert.values[0], 'job-1');
    assert.deepEqual(insert.values.slice(1, 4).slice(0, 2), [1, 12.5]);
    assert.deepEqual(insert.values.slice(4, 7).slice(0, 2), [2, 30]);
    assert.deepEqual(insert.values.slice(7, 10).slice(0, 2), [3, null]);
    assert.ok(calls.some((call) => /^BEGIN/i.test(call.text.trim())));
    assert.ok(calls.some((call) => /^COMMIT/i.test(call.text.trim())));
    assert.ok(calls.some((call) => /DELETE FROM alignment_job_rows/i.test(call.text)));
});

test('alignment export rows use one tenant-scoped cursor and bounded fetches', async () => {
    const calls = [];
    const batches = [
        { rows: [{ row: { id: 1 } }, { row: { id: 2 } }], rowCount: 2 },
        { rows: [{ row: { id: 3 } }], rowCount: 1 },
        { rows: [], rowCount: 0 },
    ];
    let released = false;
    const client = {
        async query(text, values) {
            calls.push({ text, values });
            if (/^FETCH/i.test(text.trim())) return batches.shift();
            return { rows: [], rowCount: 0 };
        },
        release() {
            released = true;
        },
    };
    const pool = { connect: async () => client };

    const rows = [];
    for await (const row of iterateOwnedAlignmentExportRows(pool, 'job-1', 22, { batchSize: 2 })) {
        rows.push(row);
    }

    assert.deepEqual(rows, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.equal(calls.filter((call) => /^FETCH/i.test(call.text.trim())).length, 3);
    assert.match(calls.find((call) => /DECLARE/i.test(call.text)).text, /jsonb_array_elements/i);
    assert.deepEqual(
        calls.find((call) => /set_config/i.test(call.text)).values,
        ['job-1', '22'],
    );
    assert.ok(calls.some((call) => /^COMMIT/i.test(call.text.trim())));
    assert.equal(released, true);
});
