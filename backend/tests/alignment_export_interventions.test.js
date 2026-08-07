const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildExportInterventionPlan,
    expandExportRow,
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

test('the workbook drops a matched fitting the reviewer excluded', () => {
    const rows = [
        {
            pair_index: 0,
            'Source Key OLD': 'old-valve',
            'Identif. OLD': 'VALVE-1',
            'Source Key NEW': 'new-valve',
            'Identif. NEW': 'VALVE-1',
            'Feature Type OLD': 'Ball Valve',
        },
        {
            pair_index: 0,
            'Source Key OLD': 'old-keep',
            'Identif. OLD': 'ML-9',
            'Source Key NEW': 'new-keep',
            'Identif. NEW': 'ML-9',
        },
    ];
    const plan = buildExportInterventionPlan(rows, [{
        id: 'exclude-valve',
        type: 'EXCLUDE_FEATURE',
        side: 'PAIR',
        pairIndex: 0,
        sourceKey: 'old-valve',
    }]);

    assert.equal(transformExportRow(rows[0], 1, plan), null);
    assert.equal(transformExportRow(rows[1], 2, plan)['Identif. OLD'], 'ML-9');
});

test('the workbook writes both halves of a match the reviewer unassigned', () => {
    const rows = [{
        pair_index: 0,
        'Source Key OLD': 'old-1',
        'Identif. OLD': 'ML-1',
        'Depth OLD (%WT)': 20,
        'Source Key NEW': 'new-1',
        'Identif. NEW': 'ML-2',
        'Depth NEW (%WT)': 26,
    }];
    const plan = buildExportInterventionPlan(rows, [{
        id: 'unassign-1',
        type: 'UNASSIGN_PAIR',
        sourceOldKey: 'old-1',
        sourceNewKey: 'new-1',
    }]);

    const released = expandExportRow(rows[0], 1, plan);

    assert.equal(released.length, 2);
    assert.equal(released[0]['Identif. OLD'], 'ML-1');
    assert.equal(released[0]['Identif. NEW'], '-');
    assert.equal(released[0]['Match/Unmatch'], 'Only OLD');
    assert.equal(released[1]['Identif. NEW'], 'ML-2');
    assert.equal(released[1]['Identif. OLD'], '-');
    assert.equal(released[1]['Match/Unmatch'], 'Only NEW');
});

test('an OLD feature can be carried onto a NEW row, the mirror of a NEW reassignment', () => {
    const rows = [
        {
            pair_index: 0,
            'Source Key OLD': 'old-source',
            'Identif. OLD': 'OLD-SOURCE',
            'Depth OLD (%WT)': 18,
            'Source Key NEW': '-',
            'Identif. NEW': '-',
        },
        {
            pair_index: 0,
            'Source Key OLD': '-',
            'Identif. OLD': '-',
            'Source Key NEW': 'new-target',
            'Identif. NEW': 'NEW-TARGET',
        },
    ];
    const plan = buildExportInterventionPlan(rows, [{
        id: 'move-old-1',
        type: 'REASSIGN_OLD',
        sourceOldKey: 'old-source',
        targetNewKey: 'new-target',
        evidenceScore: 0.8,
    }]);

    const source = transformExportRow(rows[0], 1, plan);
    const target = transformExportRow(rows[1], 2, plan);

    assert.equal(source, null, 'the emptied source row leaves the workbook');
    assert.equal(target['Identif. OLD'], 'OLD-SOURCE');
    assert.equal(target['Depth OLD (%WT)'], 18);
    assert.equal(target['Match/Unmatch'], 'Match');
});
