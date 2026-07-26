const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequirement } = require('../src/modules/compliance/complianceContract');
const { listOwnedRequirements } = require('../src/modules/compliance/complianceRepository');

test('compliance requirement requires controlled edition and source', () => {
    const item = parseRequirement({
        code: 'PLO-01', title: 'PLO evidence', edition: '2021',
        category: 'PLO', requirementText: 'Evidence required', sourceReference: 'Controlled register',
    });
    assert.equal(item.edition, '2021');
    assert.throws(() => parseRequirement({ code: 'x', title: 'x', edition: '', category: 'PLO', requirementText: 'x', sourceReference: 'x' }), /edition/i);
});

test('compliance list is organization scoped', async () => {
    const calls = [];
    await listOwnedRequirements({ query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } }, 17);
    assert.deepEqual(calls[0].values, [17]);
    assert.match(calls[0].sql, /r\.organization_id = \$1/);
});
