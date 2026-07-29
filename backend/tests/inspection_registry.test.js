const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
    parseInspectionAnchorListQuery,
    parseInspectionBucketQuery,
    parseInspectionFeatureListQuery,
    parseInspectionListQuery,
    serializeInspectionAnchor,
    serializeInspectionFeature,
    serializeInspectionProfile,
    serializeInspectionRun,
} = require('../src/modules/inspections/inspectionContract');
const {
    getOwnedInspectionBuckets,
    listOwnedInspectionAnchors,
    listOwnedInspectionFeatures,
    getOwnedInspectionProfile,
    listOwnedInspectionRuns,
} = require('../src/modules/inspections/inspectionRepository');

test('inspection list query is bounded and uses an opaque positive id cursor', () => {
    assert.deepEqual(parseInspectionListQuery({}), { limit: 30, beforeId: null });
    assert.deepEqual(parseInspectionListQuery({ limit: '100', cursor: '41' }), {
        limit: 100,
        beforeId: 41,
    });
    assert.throws(() => parseInspectionListQuery({ limit: '101' }), /between 1 and 100/);
    assert.throws(() => parseInspectionListQuery({ cursor: '0' }), /cursor/i);
});

test('inspection anchor query is keyset paginated and bounded for browser use', () => {
    assert.deepEqual(parseInspectionAnchorListQuery({}), {
        limit: 1000,
        after: null,
    });
    assert.deepEqual(parseInspectionAnchorListQuery({
        limit: '5000',
        cursor: Buffer.from(JSON.stringify({ distanceM: 120.5, id: 42 })).toString('base64url'),
    }), {
        limit: 5000,
        after: { distanceM: 120.5, id: 42 },
    });
    assert.throws(() => parseInspectionAnchorListQuery({ limit: '5001' }), /between 1 and 5000/);
    assert.throws(() => parseInspectionAnchorListQuery({ cursor: 'not-a-cursor' }), /cursor/i);
});

test('inspection viewport queries require bounded meter ranges', () => {
    assert.deepEqual(parseInspectionFeatureListQuery({ fromM: '10', toM: '100', limit: '50' }), {
        fromM: 10, toM: 100, limit: 50, after: null,
    });
    assert.deepEqual(parseInspectionBucketQuery({ fromM: '0', toM: '1000', bucketM: '25' }), {
        fromM: 0, toM: 1000, bucketM: 25, limit: 1500,
    });
    assert.throws(() => parseInspectionFeatureListQuery({ fromM: '10', toM: '9' }), /range/i);
});

test('inspection anchor serialization deliberately exposes a compact viewer shape', () => {
    const anchor = serializeInspectionAnchor({
        id: 12,
        run_id: 4,
        feature_id: 'GW-003',
        log_distance_m: '120.5',
        feature_type: 'Girth Weld',
        feature_identification: 'Weld 3',
        dist_to_us_gw_m: '0',
        joint_length_m: '12',
        clock_position: '6:00',
        depth_pct: '11.2',
        length_mm: '20',
        width_mm: '10',
    });

    assert.deepEqual(anchor, {
        id: '12',
        sourceKey: 'run:4:feature:12',
        sourceFeatureId: 'GW-003',
        dist: 120.5,
        log_distance_m: 120.5,
        source_log_distance_m: 120.5,
        type: 'Girth Weld',
        originalType: 'Girth Weld',
        feature_type: 'Girth Weld',
        feature_identification: 'Weld 3',
        dist_to_us_gw_m: 0,
        joint_length_m: 12,
        clock: '6:00',
        clock_position: '6:00',
        depth: 11.2,
        depth_pct: 11.2,
        length: 20,
        length_mm: 20,
        width: 10,
        width_mm: 10,
    });
});

test('inspection feature serialization keeps the viewport payload compact', () => {
    assert.deepEqual(serializeInspectionFeature({
        id: 5, run_id: 2, feature_id: 'ILI-5', log_distance_m: '22.5',
        feature_type: 'Metal Loss', depth_pct: '12', length_mm: '4', width_mm: '2',
    }), {
        id: '5', sourceKey: 'run:2:feature:5', sourceFeatureId: 'ILI-5',
        dist: 22.5, log_distance_m: 22.5, type: 'Metal Loss', feature_type: 'Metal Loss',
        feature_identification: null, depth_pct: 12, length_mm: 4, width_mm: 2,
    });
});

test('inspection run serialization preserves measured parser evidence without inventing quality', () => {
    const run = serializeInspectionRun({
        id: 8,
        pipeline_id: 2,
        pipeline_name: 'North Line',
        survey_year: 2026,
        vendor: 'Vendor A',
        source_file: 'north.csv',
        source_sha256: 'a'.repeat(64),
        uploaded_at: '2026-07-16T10:00:00.000Z',
        row_count: '1250',
        parser_version: 'parser-v1',
        schema_version: 'schema-v1',
        ingestion_audit: {
            source_rows: 1252,
            accepted_rows: 1250,
            rejected_rows: 2,
            mapped_columns: 14,
            recognized_header_fields: 16,
            quality_warnings: { depth_pct_out_of_range: 1 },
        },
    });

    assert.equal(run.id, 8);
    assert.equal(run.evidence.acceptedRows, 1250);
    assert.equal(run.evidence.rejectedRows, 2);
    assert.equal(run.evidence.warningCount, 1);
    assert.equal(run.evidence.status, 'review');
    assert.equal(run.provenance.sourceSha256, 'a'.repeat(64));
});

test('inspection repository applies organization scope and limit plus one pagination', async () => {
    const calls = [];
    const pool = {
        query: async (sql, values) => {
            calls.push({ sql, values });
            return { rows: [{ id: 12 }, { id: 11 }, { id: 10 }] };
        },
    };

    const page = await listOwnedInspectionRuns(pool, 7, { limit: 2, beforeId: 13 });

    assert.equal(page.rows.length, 2);
    assert.equal(page.nextCursor, 11);
    assert.match(calls[0].sql, /p\.organization_id = \$1/);
    assert.match(calls[0].sql, /sr\.id < \$2/);
    assert.deepEqual(calls[0].values, [7, 13, 3]);
});

test('inspection anchors are tenant scoped, ordered by distance, and use a composite keyset cursor', async () => {
    const calls = [];
    const pool = {
        query: async (sql, values) => {
            calls.push({ sql, values });
            return {
                rows: [
                    { id: 42, log_distance_m: 120.5 },
                    { id: 43, log_distance_m: 121 },
                    { id: 44, log_distance_m: 122 },
                ],
            };
        },
    };

    const page = await listOwnedInspectionAnchors(pool, 9, 4, {
        limit: 2,
        after: { distanceM: 120, id: 40 },
    });

    assert.equal(page.rows.length, 2);
    assert.deepEqual(page.nextCursor, { distanceM: 121, id: 43 });
    assert.match(calls[0].sql, /p\.organization_id = \$2/);
    assert.match(calls[0].sql, /LOWER\(BTRIM\(COALESCE\(f\.feature_type/);
    assert.match(calls[0].sql, /'girth weld'/);
    assert.match(calls[0].sql, /'tee \/ branch connection'/);
    assert.match(calls[0].sql, /bend\|elbow\|jog/);
    assert.match(calls[0].sql, /f\.log_distance_m > \$3/);
    assert.match(calls[0].sql, /ORDER BY f\.log_distance_m ASC, f\.id ASC/);
    assert.deepEqual(calls[0].values, [9, 4, 120, 40, 3]);
});

test('inspection features expose a tenant-scoped viewport with a composite cursor', async () => {
    const calls = [];
    const pool = { query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ id: 12, log_distance_m: 20 }, { id: 13, log_distance_m: 21 }, { id: 14, log_distance_m: 22 }] };
    } };
    const page = await listOwnedInspectionFeatures(pool, 9, 4, {
        limit: 2, fromM: 10, toM: 30, after: { distanceM: 15, id: 10 },
    });
    assert.equal(page.rows.length, 2);
    assert.deepEqual(page.nextCursor, { distanceM: 21, id: 13 });
    assert.match(calls[0].sql, /f\.log_distance_m >= \$3/);
    assert.match(calls[0].sql, /ORDER BY f\.log_distance_m ASC, f\.id ASC/);
    assert.deepEqual(calls[0].values, [9, 4, 10, 30, 15, 10, 3]);
});

test('inspection buckets aggregate server-side by chainage', async () => {
    const calls = [];
    const pool = { query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{ bucket_index: 0, feature_count: '12', anomaly_count: '2', max_depth_pct: '35' }] };
    } };
    const rows = await getOwnedInspectionBuckets(pool, 9, 4, {
        fromM: 100, toM: 200, bucketM: 10, limit: 1500,
    });
    assert.equal(rows[0].feature_count, '12');
    assert.match(calls[0].sql, /GROUP BY bucket_index/);
    assert.deepEqual(calls[0].values, [9, 4, 100, 200, 10, 1500]);
});

test('inspection profile is tenant scoped and reports explicit field coverage', async () => {
    const calls = [];
    const pool = {
        query: async (sql, values) => {
            calls.push({ sql, values });
            return {
                rows: [{
                    id: 9,
                    feature_count: '100',
                    minimum_distance_m: '0',
                    maximum_distance_m: '950.5',
                    missing_feature_type: '3',
                    invalid_depth: '2',
                    depth_populated: '80',
                    wall_thickness_populated: '75',
                    clock_populated: '60',
                }],
            };
        },
    };

    const row = await getOwnedInspectionProfile(pool, 9, 4);
    const profile = serializeInspectionProfile(row);

    assert.match(calls[0].sql, /p\.organization_id = \$2/);
    assert.deepEqual(calls[0].values, [9, 4]);
    assert.equal(profile.featureCount, 100);
    assert.equal(profile.coverage.depthPercent, 80);
    assert.equal(profile.coverage.wallThicknessPercent, 75);
    assert.equal(profile.invalid.depthOutOfRange, 2);
});
