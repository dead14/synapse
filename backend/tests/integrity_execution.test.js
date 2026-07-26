const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseAdvanceStage, parseApproval, parseCreateIntegrityCase,
    parseEvidenceTransition, parseRepairPlan,
} = require('../src/modules/integrity/integrityContract');
const {
    advanceOwnedIntegrityCase, createOwnedApproval, createOwnedIntegrityCase,
    listOwnedIntegrityCases,
} = require('../src/modules/integrity/integrityRepository');

test('integrity case contract validates confidence, response, and ordered stages', () => {
    const parsed = parseCreateIntegrityCase({
        anomalyKey: 'run-2:feature-4', title: 'External metal loss',
        dataQualityConfidence: 0.82, responseCategory: 'scheduled',
        methodMetadata: { method: 'Modified B31G', edition: '2023' },
    });
    assert.equal(parsed.dataQualityConfidence, 0.82);
    assert.equal(parseAdvanceStage('assess', 'decide'), 'decide');
    assert.throws(() => parseAdvanceStage('assess', 'repair'), /next stage/i);
    assert.throws(() => parseCreateIntegrityCase({ anomalyKey: 'a', title: 'b', dataQualityConfidence: 2 }), /between 0 and 1/i);
});

test('approval, repair, and evidence contracts fail closed', () => {
    assert.deepEqual(parseApproval({ decision: 'approved', reason: 'Reviewed' }), {
        decision: 'approved', reason: 'Reviewed',
    });
    assert.equal(parseRepairPlan({ repairMethod: 'Type B sleeve', engineeringBasis: 'Approved assessment' }).repairMethod, 'Type B sleeve');
    assert.equal(parseEvidenceTransition('submitted', 'reviewed'), 'reviewed');
    assert.throws(() => parseEvidenceTransition('submitted', 'accepted'), /invalid evidence transition/i);
    assert.throws(() => parseApproval({ decision: 'pending', reason: 'x' }), /approved or rejected/i);
});

test('stage advance and approval repositories remain organization scoped', async () => {
    const calls = [];
    const pool = {
        async query(sql, values) {
            calls.push({ sql, values });
            return { rows: [{ id: 1 }] };
        },
    };
    await advanceOwnedIntegrityCase(pool, 10, 20, 'validate');
    await createOwnedApproval(pool, 10, 20, 30, { decision: 'approved', reason: 'ok' });
    assert.match(calls[0].sql, /organization_id = \$2/);
    assert.match(calls[0].sql, /integrity_approvals/);
    assert.match(calls[1].sql, /owner_id IS DISTINCT FROM \$5/);
    assert.deepEqual(calls[1].values, [10, 20, 'approved', 'ok', 30]);
});

test('integrity repository scopes list and create by organization', async () => {
    const calls = [];
    const pool = {
        async query(sql, values) {
            calls.push({ sql, values });
            return { rows: sql.includes('INSERT INTO') ? [{ id: 9 }] : [] };
        },
    };
    await listOwnedIntegrityCases(pool, 41, 999);
    await createOwnedIntegrityCase(pool, 41, 7, {
        pipelineId: 5, anomalyKey: 'a-1', title: 'Case', responseCategory: null,
        dataQualityConfidence: 0.8, dueAt: null, methodMetadata: {},
    });
    assert.deepEqual(calls[0].values, [41, 200]);
    assert.equal(calls[1].values[0], 41);
    assert.match(calls[1].sql, /p\.organization_id = \$1/);
});
