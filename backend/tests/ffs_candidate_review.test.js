const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFfsCandidateSelection, MAX_ITEMS } = require('../src/modules/ffs/ffsCandidateContract');
const {
    GATE_REASONS,
    currentResultSignature,
    evaluateSession,
    finalPhaseRejection,
    reviewRejection,
} = require('../src/modules/ffs/ffsEligibility');
const {
    listFfsCandidates,
    listResultSourceKeys,
    listReviewedSessions,
    replaceFfsCandidates,
} = require('../src/modules/ffs/ffsCandidateRepository');

function recordingPool(results = [{ rows: [], rowCount: 0 }]) {
    const calls = [];
    let index = 0;
    const nextResult = () => results[Math.min(index++, results.length - 1)];
    return {
        calls,
        async query(text, values) {
            calls.push({ text, values });
            return nextResult();
        },
        async connect() {
            return {
                query: async (text, values) => {
                    calls.push({ text, values });
                    return nextResult();
                },
                release() {},
            };
        },
    };
}

function completedSession({ params_json: params, ...overrides } = {}) {
    return {
        id: 7,
        status: 'completed',
        ...overrides,
        params_json: {
            algorithm: 'dtw_hungarian_onedirection',
            resultSummary: { anomaliesFound: 12 },
            ...params,
        },
    };
}

test('contract rejects duplicate, malformed, and oversized reviews', () => {
    const parsed = parseFfsCandidateSelection({
        signature: 'abc123',
        items: [
            { sourceKey: ' NEW-1 ', selected: true, reason: ' deep pit ' },
            { sourceKey: 'NEW-2', selected: false, featureId: 'A-14' },
        ],
    });

    assert.equal(parsed.items[0].sourceKey, 'NEW-1');
    assert.equal(parsed.items[0].reason, 'deep pit');
    assert.equal(parsed.items[1].featureId, 'A-14');
    assert.equal(parsed.items[1].reason, null);

    assert.throws(() => parseFfsCandidateSelection({
        signature: 'abc123',
        items: [
            { sourceKey: 'NEW-1', selected: true },
            { sourceKey: 'NEW-1', selected: false },
        ],
    }), /duplicated/i);

    assert.throws(() => parseFfsCandidateSelection({
        signature: 'abc123',
        items: [{ sourceKey: 'NEW-1', selected: 'yes' }],
    }), /must be a boolean/i);

    assert.throws(() => parseFfsCandidateSelection({ items: [] }), /signature is required/i);

    assert.throws(() => parseFfsCandidateSelection({
        signature: 'abc123',
        items: Array.from({ length: MAX_ITEMS + 1 }, (_, index) => ({
            sourceKey: `NEW-${index}`,
            selected: false,
        })),
    }), /exceeds/i);
});

test('gate A rejects sessions that never reached the final phase', () => {
    assert.equal(finalPhaseRejection({ status: 'in_progress' }), GATE_REASONS.NOT_COMPLETED);
    assert.equal(
        finalPhaseRejection({ status: 'completed', params_json: { algorithm: 'dtw_hungarian_onedirection' } }),
        GATE_REASONS.NO_RESULT,
    );
    assert.equal(
        finalPhaseRejection(completedSession({ params_json: { algorithm: 'manual' } })),
        GATE_REASONS.MANUAL_ALIGNMENT,
    );
    assert.equal(
        finalPhaseRejection(completedSession({ params_json: { algorithm: 'traditional_hungarian' } })),
        GATE_REASONS.STRATEGY_NOT_VALIDATED,
    );
    assert.equal(finalPhaseRejection(completedSession()), null);
});

test('gate A accepts a JSON-encoded params column', () => {
    const session = completedSession();
    const encoded = { ...session, params_json: JSON.stringify(session.params_json) };

    assert.equal(finalPhaseRejection(encoded), null);
    assert.equal(currentResultSignature(encoded), currentResultSignature(session));
});

test('gate B requires a saved, non-empty, current review', () => {
    const session = completedSession();
    const signature = currentResultSignature(session);

    assert.equal(
        reviewRejection(session, { reviewed_count: 0, selected_count: 0 }),
        GATE_REASONS.NOT_REVIEWED,
    );
    assert.equal(
        reviewRejection(session, { reviewed_count: 40, selected_count: 0, min_signature: signature, max_signature: signature }),
        GATE_REASONS.NOTHING_SELECTED,
    );
    assert.equal(
        reviewRejection(session, {
            reviewed_count: 40,
            selected_count: 6,
            min_signature: 'signature-from-a-previous-run',
            max_signature: 'signature-from-a-previous-run',
        }),
        GATE_REASONS.STALE_REVIEW,
    );
    assert.equal(
        reviewRejection(session, {
            reviewed_count: 40,
            selected_count: 6,
            min_signature: signature,
            max_signature: signature,
        }),
        null,
    );
});

test('a re-run with a different configuration invalidates the saved review', () => {
    const session = completedSession();
    const signature = currentResultSignature(session);
    const rerun = completedSession({
        params_json: { algorithm: 'dtw_hungarian_onedirection', resultSummary: { anomaliesFound: 12 }, ota: 0.9 },
    });

    assert.notEqual(currentResultSignature(rerun), signature);

    const review = { reviewed_count: 40, selected_count: 6, min_signature: signature, max_signature: signature };
    assert.equal(evaluateSession(session, review).eligible, true);

    const verdict = evaluateSession(rerun, review);
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.stale, true);
});

test('candidate queries stay scoped to the owning organization', async () => {
    const pool = recordingPool([{ rows: [], rowCount: 0 }]);

    await listFfsCandidates(pool, 7, 22);
    assert.match(pool.calls[0].text, /COALESCE\(s\.organization_id, p\.organization_id\) = \$2/i);
    assert.deepEqual(pool.calls[0].values, [7, 22]);

    await listReviewedSessions(pool, 22);
    assert.match(pool.calls[1].text, /s\.status = 'completed'/i);
    assert.match(pool.calls[1].text, /FILTER \(WHERE c\.selected\)/i);
});

test('result source keys come from the latest completed alignment job', async () => {
    const pool = recordingPool([{
        rows: [{ source_key: 'NEW-1' }, { source_key: 'NEW-2' }],
        rowCount: 2,
    }]);

    const keys = await listResultSourceKeys(pool, 7, 22);

    assert.deepEqual([...keys].sort(), ['NEW-1', 'NEW-2']);
    assert.match(pool.calls[0].text, /state = 'completed'/i);
    assert.match(pool.calls[0].text, /Source Key NEW/);
});

test('saving a review replaces the previous one inside a transaction', async () => {
    const pool = recordingPool([{ rows: [], rowCount: 0 }]);

    await replaceFfsCandidates(pool, {
        sessionId: 7,
        orgId: 22,
        userId: 4,
        signature: 'sig',
        items: [{ sourceKey: 'NEW-1', featureId: 'A-1', selected: true, reason: null }],
    });

    const statements = pool.calls.map((call) => call.text.trim().split(/\s+/)[0].toUpperCase());
    assert.deepEqual(statements.slice(0, 4), ['BEGIN', 'DELETE', 'INSERT', 'COMMIT']);

    const insert = pool.calls.find((call) => call.text.includes('INSERT INTO ffs_candidates'));
    assert.deepEqual(JSON.parse(insert.values[4]), [
        { source_key: 'NEW-1', feature_id: 'A-1', selected: true, reason: null },
    ]);
});

test('a failed save rolls back instead of leaving a partial review', async () => {
    const calls = [];
    const pool = {
        async connect() {
            return {
                query: async (text) => {
                    calls.push(text.trim().split(/\s+/)[0].toUpperCase());
                    if (text.includes('INSERT INTO ffs_candidates')) throw new Error('constraint violation');
                    return { rows: [], rowCount: 0 };
                },
                release() {},
            };
        },
    };

    await assert.rejects(() => replaceFfsCandidates(pool, {
        sessionId: 7,
        orgId: 22,
        userId: 4,
        signature: 'sig',
        items: [{ sourceKey: 'NEW-1', featureId: null, selected: true, reason: null }],
    }), /constraint violation/);

    assert.deepEqual(calls, ['BEGIN', 'DELETE', 'INSERT', 'ROLLBACK']);
});
