const test = require('node:test');
const assert = require('node:assert/strict');

const { getDashboardOverviewRows } = require('../src/modules/dashboard/dashboardRepository');

test('dashboard overview queries keep an organization scope when no pipeline exists', async () => {
    const calls = [];
    const responses = [
        { rows: [] },
        { rows: [{ active_ingestion_jobs: '2', critical_cases: '1' }] },
        { rows: [{ id: 7, title: 'Review metal loss' }] },
    ];
    const pool = {
        query: async (sql, values) => {
            calls.push({ sql, values });
            return responses.shift();
        },
    };

    const result = await getDashboardOverviewRows(pool, 41);

    assert.equal(calls.length, 3);
    assert.ok(calls.every(({ values }) => values.includes(41)));
    assert.deepEqual(result, {
        primaryPipeline: null,
        operational: { active_ingestion_jobs: '2', critical_cases: '1' },
        latestRun: null,
        heatmapRows: [],
        corridorRows: [],
        findingRows: [{ id: 7, title: 'Review metal loss' }],
    });
});
