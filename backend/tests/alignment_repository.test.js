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
    assert.deepEqual(pool.calls[0].values.slice(1), [7, 22]);
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
