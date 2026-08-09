const { alignmentAnchorSqlPredicate } = require('../alignment/alignmentAnchorTypes');

async function listOwnedInspectionRuns(pool, orgId, { limit, beforeId }) {
    const values = [orgId];
    const cursorClause = beforeId === null
        ? ''
        : `AND sr.id < $${values.push(beforeId)}`;
    const limitParameter = values.push(limit + 1);

    const result = await pool.query(
        `SELECT sr.id, sr.pipeline_id, p.name AS pipeline_name,
                sr.survey_year, sr.vendor, sr.source_file, sr.source_object_key, sr.source_sha256,
                sr.uploaded_at, sr.row_count, sr.parser_version,
                sr.schema_version, sr.ingestion_audit,
                workflow.workflow_stage, workflow.workflow_session_id,
                workflow.workflow_ffs_session_id
         FROM survey_runs sr
         JOIN pipelines p ON p.id = sr.pipeline_id
         LEFT JOIN LATERAL (
             SELECT s.id AS workflow_session_id,
                    ffs.id AS workflow_ffs_session_id,
                    CASE
                        -- A saved assessment outranks a released selection:
                        -- "features were released to FFS" and "an FFS run was
                        -- completed and filed" are different states, and the
                        -- registry offers a different action for each.
                        WHEN ffs.id IS NOT NULL THEN 'assessed'
                        WHEN EXISTS (
                            SELECT 1 FROM ffs_candidates c
                            WHERE c.session_id = s.id AND c.selected = true
                        ) THEN 'ffs'
                        WHEN EXISTS (
                            SELECT 1 FROM alignment_jobs j
                            WHERE j.session_id = s.id
                              AND j.organization_id = $1
                              AND j.state = 'completed'
                        ) THEN 'runcomp'
                        WHEN s.status = 'in_progress' THEN 'alignment'
                        ELSE 'imported'
                    END AS workflow_stage
             FROM alignment_sessions s
             LEFT JOIN pipelines session_pipeline ON session_pipeline.id = s.pipeline_id
             LEFT JOIN LATERAL (
                 SELECT f.id
                 FROM ffs_sessions f
                 WHERE f.alignment_session_id = s.id
                   AND f.organization_id = $1
                 ORDER BY f.created_at DESC, f.id DESC
                 LIMIT 1
             ) ffs ON true
             WHERE (s.run_old_id = sr.id OR s.run_new_id = sr.id)
               AND COALESCE(s.organization_id, session_pipeline.organization_id) = $1
             ORDER BY CASE
                 WHEN ffs.id IS NOT NULL THEN 4
                 WHEN EXISTS (SELECT 1 FROM ffs_candidates c WHERE c.session_id = s.id AND c.selected = true) THEN 3
                 WHEN EXISTS (SELECT 1 FROM alignment_jobs j WHERE j.session_id = s.id AND j.organization_id = $1 AND j.state = 'completed') THEN 2
                 WHEN s.status = 'in_progress' THEN 1
                 ELSE 0
             END DESC,
             s.completed_at DESC NULLS LAST,
             s.started_at DESC,
             s.id DESC
             LIMIT 1
         ) workflow ON true
         WHERE p.organization_id = $1
           ${cursorClause}
         ORDER BY sr.id DESC
         LIMIT $${limitParameter}`,
        values,
    );

    const hasNextPage = result.rows.length > limit;
    const rows = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    return {
        rows,
        nextCursor: hasNextPage && rows.length > 0 ? Number(rows[rows.length - 1].id) : null,
    };
}

async function getOwnedInspectionProfile(pool, runId, orgId) {
    const result = await pool.query(
        `SELECT sr.id,
                COUNT(f.id) AS feature_count,
                MIN(f.log_distance_m) AS minimum_distance_m,
                MAX(f.log_distance_m) AS maximum_distance_m,
                COUNT(f.id) FILTER (
                    WHERE f.feature_type IS NULL OR btrim(f.feature_type) = ''
                ) AS missing_feature_type,
                COUNT(f.id) FILTER (
                    WHERE f.depth_pct IS NOT NULL
                      AND (f.depth_pct < 0 OR f.depth_pct > 100)
                ) AS invalid_depth,
                COUNT(f.id) FILTER (WHERE f.depth_pct IS NOT NULL) AS depth_populated,
                COUNT(f.id) FILTER (WHERE f.wall_thickness_mm IS NOT NULL) AS wall_thickness_populated,
                COUNT(f.id) FILTER (
                    WHERE f.clock_position IS NOT NULL AND btrim(f.clock_position) != ''
                ) AS clock_populated
         FROM survey_runs sr
         JOIN pipelines p ON p.id = sr.pipeline_id
         LEFT JOIN ili_features f ON f.run_id = sr.id
         WHERE sr.id = $1
           AND p.organization_id = $2
         GROUP BY sr.id`,
        [runId, orgId],
    );
    return result.rows[0] || null;
}

async function listOwnedInspectionAnchors(pool, runId, orgId, { limit, after }) {
    const values = [runId, orgId];
    let cursorClause = '';
    if (after !== null) {
        const distanceParameter = values.push(after.distanceM);
        const idParameter = values.push(after.id);
        cursorClause = `AND (f.log_distance_m > $${distanceParameter}
              OR (f.log_distance_m = $${distanceParameter}
                  AND f.id > $${idParameter}))`;
    }
    const limitParameter = values.push(limit + 1);

    const result = await pool.query(
        `SELECT f.id, f.run_id, f.feature_id, f.log_distance_m,
                f.feature_type, f.feature_identification, f.dist_to_us_gw_m,
                f.joint_length_m, f.clock_position, f.depth_pct,
                f.length_mm, f.width_mm
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = $1
           AND p.organization_id = $2
           AND ${alignmentAnchorSqlPredicate('f')}
           ${cursorClause}
         ORDER BY f.log_distance_m ASC, f.id ASC
         LIMIT $${limitParameter}`,
        values,
    );

    const hasNextPage = result.rows.length > limit;
    const rows = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const tail = rows[rows.length - 1];
    return {
        rows,
        nextCursor: hasNextPage && tail
            ? { distanceM: Number(tail.log_distance_m), id: Number(tail.id) }
            : null,
    };
}

async function listOwnedInspectionFeatures(pool, runId, orgId, { limit, fromM, toM, after }) {
    const startedAt = performance.now();
    const values = [runId, orgId, fromM, toM];
    let cursorClause = '';
    if (after !== null) {
        const distanceParameter = values.push(after.distanceM);
        const idParameter = values.push(after.id);
        cursorClause = `AND (f.log_distance_m > $${distanceParameter}
              OR (f.log_distance_m = $${distanceParameter} AND f.id > $${idParameter}))`;
    }
    const limitParameter = values.push(limit + 1);
    const result = await pool.query(
        `SELECT f.id, f.run_id, f.feature_id, f.log_distance_m,
                f.feature_type, f.feature_identification, f.depth_pct,
                f.length_mm, f.width_mm
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = $1
           AND p.organization_id = $2
           AND f.log_distance_m >= $3
           AND f.log_distance_m <= $4
           ${cursorClause}
         ORDER BY f.log_distance_m ASC, f.id ASC
         LIMIT $${limitParameter}`,
        values,
    );
    metrics.observe('inspection_viewport_query', performance.now() - startedAt, { query: 'features' });
    const hasNextPage = result.rows.length > limit;
    const rows = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const tail = rows[rows.length - 1];
    return {
        rows,
        nextCursor: hasNextPage && tail
            ? { distanceM: Number(tail.log_distance_m), id: Number(tail.id) }
            : null,
    };
}

async function getOwnedInspectionBuckets(pool, runId, orgId, { fromM, toM, bucketM, limit }) {
    const startedAt = performance.now();
    const result = await pool.query(
        `SELECT floor((f.log_distance_m - $3) / $5)::int AS bucket_index,
                ($3 + floor((f.log_distance_m - $3) / $5) * $5) AS bucket_from_m,
                ($3 + (floor((f.log_distance_m - $3) / $5) + 1) * $5) AS bucket_to_m,
                COUNT(*) AS feature_count,
                COUNT(*) FILTER (WHERE COALESCE(f.depth_pct, 0) >= 20
                                  OR LOWER(COALESCE(f.feature_type, '')) IN ('metal loss', 'dent')) AS anomaly_count,
                MAX(f.depth_pct) AS max_depth_pct,
                (array_agg(COALESCE(NULLIF(btrim(f.feature_type), ''), 'Other')
                           ORDER BY f.depth_pct DESC NULLS LAST, f.id ASC))[1] AS representative_type
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = $1
           AND p.organization_id = $2
           AND f.log_distance_m >= $3
           ${cursorClause}
         ORDER BY f.log_distance_m ASC, f.id ASC
         LIMIT $${limitParameter}`,
        values,
    );

    const hasNextPage = result.rows.length > limit;
    const rows = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const tail = rows[rows.length - 1];
    return {
        rows,
        nextCursor: hasNextPage && tail
            ? { distanceM: Number(tail.log_distance_m), id: Number(tail.id) }
            : null,
    };
}

async function listOwnedInspectionFeatures(pool, runId, orgId, { limit, fromM, toM, after }) {
    const startedAt = performance.now();
    const values = [runId, orgId, fromM, toM];
    let cursorClause = '';
    if (after !== null) {
        const distanceParameter = values.push(after.distanceM);
        const idParameter = values.push(after.id);
        cursorClause = `AND (f.log_distance_m > $${distanceParameter}
              OR (f.log_distance_m = $${distanceParameter} AND f.id > $${idParameter}))`;
    }
    const limitParameter = values.push(limit + 1);
    const result = await pool.query(
        `SELECT f.id, f.run_id, f.feature_id, f.log_distance_m,
                f.feature_type, f.feature_identification, f.depth_pct,
                f.length_mm, f.width_mm
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = $1
           AND p.organization_id = $2
           AND f.log_distance_m >= $3
           AND f.log_distance_m <= $4
           ${cursorClause}
         ORDER BY f.log_distance_m ASC, f.id ASC
         LIMIT $${limitParameter}`,
        values,
    );
    metrics.observe('inspection_viewport_query', performance.now() - startedAt, { query: 'features' });
    const hasNextPage = result.rows.length > limit;
    const rows = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const tail = rows[rows.length - 1];
    return {
        rows,
        nextCursor: hasNextPage && tail
            ? { distanceM: Number(tail.log_distance_m), id: Number(tail.id) }
            : null,
    };
}

async function getOwnedInspectionBuckets(pool, runId, orgId, { fromM, toM, bucketM, limit }) {
    const startedAt = performance.now();
    const result = await pool.query(
        `SELECT floor((f.log_distance_m - $3) / $5)::int AS bucket_index,
                ($3 + floor((f.log_distance_m - $3) / $5) * $5) AS bucket_from_m,
                ($3 + (floor((f.log_distance_m - $3) / $5) + 1) * $5) AS bucket_to_m,
                COUNT(*) AS feature_count,
                COUNT(*) FILTER (WHERE COALESCE(f.depth_pct, 0) >= 20
                                  OR LOWER(COALESCE(f.feature_type, '')) IN ('metal loss', 'dent')) AS anomaly_count,
                MAX(f.depth_pct) AS max_depth_pct,
                (array_agg(COALESCE(NULLIF(btrim(f.feature_type), ''), 'Other')
                           ORDER BY f.depth_pct DESC NULLS LAST, f.id ASC))[1] AS representative_type
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = $1
           AND p.organization_id = $2
           AND f.log_distance_m >= $3
           AND f.log_distance_m < $4
         GROUP BY bucket_index, bucket_from_m, bucket_to_m
         ORDER BY bucket_index ASC
         LIMIT $6`,
        [runId, orgId, fromM, toM, bucketM, limit],
    );
    metrics.observe('inspection_viewport_query', performance.now() - startedAt, { query: 'buckets' });
    return result.rows;
}

async function deleteOwnedInspectionRun(pool, runId, orgId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            `SELECT sr.id FROM survey_runs sr 
             JOIN pipelines p ON p.id = sr.pipeline_id 
             WHERE sr.id = $1 AND p.organization_id = $2`,
            [runId, orgId]
        );
        if (res.rowCount === 0) {
            await client.query('ROLLBACK');
            return false;
        }

        await client.query('DELETE FROM ili_features WHERE run_id = $1', [runId]);
        await client.query('DELETE FROM survey_runs WHERE id = $1', [runId]);
        
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    deleteOwnedInspectionRun,
    getOwnedInspectionBuckets,
    getOwnedInspectionProfile,
    listOwnedInspectionAnchors,
    listOwnedInspectionFeatures,
    listOwnedInspectionRuns,
};
const metrics = require('../../observability/metrics');
