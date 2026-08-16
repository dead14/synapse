const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseCreateFfsSession,
    parseUpdateFfsSession,
} = require('../src/modules/ffs/ffsSessionContract');
const {
    insertFfsSession,
    updateOwnedFfsSession,
    getOwnedFfsSession,
} = require('../src/modules/ffs/ffsSessionRepository');

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

const validState = {
    kind: 'FFS',
    results: [{ key: 'ffs:1', ERF: 0.4 }],
    config: { lineName: 'Line 12', iliDate: '2026-03-14T00:00:00.000Z' },
    screening: { depthTolerancePct: 10 },
    review: { repairOverrides: { 3: { repairStatus: 'temporary-repair' } } },
};

test('a saved assessment carries the reviewer decisions through the contract', () => {
    const parsed = parseCreateFfsSession({
        label: 'Line 12',
        method: 'modified',
        alignmentSessionId: '12',
        featureCount: 1,
        summary: { pass: 1, fail: 0, note: 'x' },
        state: validState,
    });

    assert.equal(parsed.alignmentSessionId, 12);
    assert.equal(parsed.featureCount, 1);
    assert.deepEqual(parsed.summary, { pass: 1, fail: 0, note: 'x' });
    // The case is sanitised, not field-checked: its shape belongs to the results
    // page. What matters here is that nothing was dropped on the way through.
    assert.deepEqual(parsed.state.review, { repairOverrides: { 3: { repairStatus: 'temporary-repair' } } });
});

test('an update may re-file the case but never move it to another owner', () => {
    const parsed = parseUpdateFfsSession({
        label: 'Line 12',
        method: 'modified',
        featureCount: 2,
        summary: { pass: 2 },
        state: validState,
        // Ownership fields are not part of the update contract at all, so a
        // client cannot re-point a filed assessment at another tenant's session.
        alignmentSessionId: '99',
        pipelineId: '77',
        organizationId: 4,
    });

    assert.equal(parsed.label, 'Line 12');
    assert.equal(parsed.featureCount, 2);
    assert.equal(parsed.alignmentSessionId, undefined);
    assert.equal(parsed.pipelineId, undefined);
    assert.equal(parsed.organizationId, undefined);
});

test('a session without a readable case is refused rather than stored empty', () => {
    assert.throws(() => parseUpdateFfsSession({ label: 'Line 12' }), /state must be an object/);
    assert.throws(() => parseCreateFfsSession({ state: validState }), /label is required/);
    assert.throws(
        () => parseCreateFfsSession({ label: 'Line 12', state: validState, alignmentSessionId: 'abc' }),
        /positive integer/,
    );
});

test('re-filing is scoped to the owning organization', async () => {
    const pool = recordingPool({ rows: [{ id: 5, created_at: '2026-08-01T00:00:00.000Z' }], rowCount: 1 });

    const updated = await updateOwnedFfsSession(pool, 5, 22, {
        label: 'Line 12',
        method: 'modified',
        featureCount: 2,
        summary: {},
        state: validState,
    });

    assert.equal(updated.id, 5);
    assert.match(pool.calls[0].text, /UPDATE ffs_sessions/i);
    assert.match(pool.calls[0].text, /WHERE id = \$1 AND organization_id = \$2/i);
    assert.equal(pool.calls[0].values[0], 5);
    assert.equal(pool.calls[0].values[1], 22);
});

test('a session another organization owns reads back as absent, not as forbidden', async () => {
    const pool = recordingPool({ rows: [], rowCount: 0 });

    assert.equal(await updateOwnedFfsSession(pool, 5, 22, {
        label: 'x', method: null, featureCount: 0, summary: {}, state: validState,
    }), null);
    assert.equal(await getOwnedFfsSession(pool, 5, 22), null);
});

test('a new assessment records who filed it and what it came from', async () => {
    const pool = recordingPool({ rows: [{ id: 9, created_at: '2026-08-01T00:00:00.000Z' }], rowCount: 1 });

    await insertFfsSession(pool, {
        orgId: 22,
        userId: 3,
        alignmentSessionId: 12,
        pipelineId: 4,
        label: 'Line 12',
        method: 'modified',
        featureCount: 1,
        summary: { pass: 1 },
        state: validState,
    });

    assert.match(pool.calls[0].text, /INSERT INTO ffs_sessions/i);
    assert.deepEqual(pool.calls[0].values.slice(0, 6), [22, 12, 4, 'Line 12', 'modified', 1]);
});
