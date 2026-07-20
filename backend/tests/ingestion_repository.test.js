const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ensureOwnedPipeline,
    findOwnedPersistedRunByChecksum,
} = require('../src/modules/ingestion/ingestionRepository');

function recordingPool(rows = []) {
    const calls = [];
    return {
        calls,
        async query(text, values) {
            calls.push({ text, values });
            return { rows, rowCount: rows.length };
        },
    };
}

test('ensures one tenant-scoped pipeline before concurrent ingestion jobs start', async () => {
    const pool = recordingPool([{ id: 41 }]);

    const pipeline = await ensureOwnedPipeline(pool, {
        organizationId: 9,
        pipelineName: 'North Line',
    });

    assert.deepEqual(pipeline, { id: 41 });
    assert.match(pool.calls[0].text, /INSERT INTO pipelines/i);
    assert.match(pool.calls[0].text, /ON CONFLICT \(organization_id, lower\(name\)\)/i);
    assert.deepEqual(pool.calls[0].values, [9, 'North Line']);
});

test('finds a matching persisted run by organization, pipeline, and source checksum', async () => {
    const pool = recordingPool([{
        run_id: 72,
        row_count: 1538,
        source_sha256: 'abc123',
        ingestion_audit: { accepted_rows: 1538, feature_counts: { total: 1538 } },
    }]);

    const run = await findOwnedPersistedRunByChecksum(pool, {
        organizationId: 9,
        pipelineName: 'North Line',
        sourceSha256: 'abc123',
    });

    assert.equal(run.run_id, 72);
    assert.match(pool.calls[0].text, /JOIN pipelines/i);
    assert.match(pool.calls[0].text, /p\.organization_id = \$1/i);
    assert.match(pool.calls[0].text, /lower\(p\.name\) = lower\(\$2\)/i);
    assert.match(pool.calls[0].text, /sr\.source_sha256 = \$3/i);
    assert.deepEqual(pool.calls[0].values, [9, 'North Line', 'abc123']);
});
