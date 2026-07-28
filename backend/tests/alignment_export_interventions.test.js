const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildExportInterventionPlan,
    transformExportRow,
} = require('../src/modules/alignment/exportInterventions');

test('stream export plan reassigns NEW evidence without losing the source OLD row', () => {
    const rows = [
        {
            pair_index: 0,
            'Source Key OLD': 'old-source',
            'Identif. OLD': 'OLD-SOURCE',
            'Source Key NEW': 'new-source',
            'Identif. NEW': 'NEW-SOURCE',
            'Depth NEW (%WT)': 25,
        },
        {
            pair_index: 0,
            'Source Key OLD': 'old-target',
            'Identif. OLD': 'OLD-TARGET',
            'Source Key NEW': '-',
            'Identif. NEW': '-',
        },
    ];
    const plan = buildExportInterventionPlan(rows, [{
        id: 'move-1',
        type: 'REASSIGN_NEW',
        sourceNewKey: 'new-source',
        targetOldKey: 'old-target',
        evidenceScore: 0.92,
    }]);

    const source = transformExportRow(rows[0], 1, plan);
    const target = transformExportRow(rows[1], 2, plan);

    assert.equal(source['Identif. OLD'], 'OLD-SOURCE');
    assert.equal(source['Identif. NEW'], '-');
    assert.equal(target['Identif. NEW'], 'NEW-SOURCE');
    assert.equal(target['Depth NEW (%WT)'], 25);
    assert.equal(target['Intervention ID'], 'move-1');
});

test('stream export replays chained reassignments in saved event order', () => {
    const rows = [
        {
            pair_index: 0,
            'Source Key OLD': 'old-source',
            'Identif. OLD': 'OLD-SOURCE',
            'Source Key NEW': 'new-source',
            'Identif. NEW': 'NEW-SOURCE',
        },
        {
            pair_index: 0,
            'Source Key OLD': 'old-target-1',
            'Identif. OLD': 'OLD-TARGET-1',
            'Source Key NEW': '-',
            'Identif. NEW': '-',
        },
        {
            pair_index: 0,
            'Source Key OLD': 'old-target-2',
            'Identif. OLD': 'OLD-TARGET-2',
            'Source Key NEW': '-',
            'Identif. NEW': '-',
        },
    ];
    const plan = buildExportInterventionPlan(rows, [
        {
            id: 'move-1',
            type: 'REASSIGN_NEW',
            sourceNewKey: 'new-source',
            targetOldKey: 'old-target-1',
            evidenceScore: 0.9,
        },
        {
            id: 'move-2',
            type: 'REASSIGN_NEW',
            sourceNewKey: 'new-source',
            targetOldKey: 'old-target-2',
            evidenceScore: 0.95,
        },
    ]);

    assert.equal(transformExportRow(rows[0], 1, plan)['Identif. NEW'], '-');
    assert.equal(transformExportRow(rows[1], 2, plan)['Identif. NEW'], '-');
    assert.equal(transformExportRow(rows[2], 3, plan)['Identif. NEW'], 'NEW-SOURCE');
    assert.equal(transformExportRow(rows[2], 3, plan)['Intervention ID'], 'move-2');
});

test('stream export plan removes active range exclusions and honors restore events', () => {
    const rows = [10, 20, 30].map((distance, index) => ({
        pair_index: 0,
        'Source Key OLD': `old-${index}`,
        'Identif. OLD': `OLD-${index}`,
        'Source Key NEW': '-',
        'Identif. NEW': '-',
        'Log Dist OLD (m)': distance,
    }));
    const exclusion = {
        id: 'exclude-1',
        type: 'EXCLUDE_RANGE',
        side: 'OLD',
        pairIndex: 0,
        startSourceKey: 'old-0',
        endSourceKey: 'old-1',
    };
    const activePlan = buildExportInterventionPlan(rows, [exclusion]);
    const restoredPlan = buildExportInterventionPlan(rows, [
        exclusion,
        { id: 'restore-1', type: 'RESTORE_EXCLUSION', exclusionId: 'exclude-1' },
    ]);

    assert.equal(transformExportRow(rows[0], 1, activePlan), null);
    assert.equal(transformExportRow(rows[1], 2, activePlan), null);
    assert.notEqual(transformExportRow(rows[2], 3, activePlan), null);
    assert.notEqual(transformExportRow(rows[0], 1, restoredPlan), null);
});
