async function getDashboardOverviewRows(pool, orgId) {
    const primaryPipelineResult = await pool.query(
        `SELECT p.id,
                p.name,
                COUNT(DISTINCT sr.id) AS run_count,
                MAX(sr.uploaded_at) AS latest_uploaded_at
         FROM pipelines p
         LEFT JOIN survey_runs sr ON sr.pipeline_id = p.id
         WHERE p.organization_id = $1
         GROUP BY p.id, p.name
         ORDER BY MAX(sr.uploaded_at) DESC NULLS LAST, p.id ASC
         LIMIT 1`,
        [orgId],
    );
    const primaryPipeline = primaryPipelineResult.rows[0] || null;

    const [operationalResult, findingResult] = await Promise.all([
        pool.query(
            `SELECT
                (SELECT COUNT(*) FROM ingestion_jobs
                 WHERE organization_id = $1 AND state IN ('queued', 'running')) AS active_ingestion_jobs,
                (SELECT COUNT(*) FROM integrity_cases
                 WHERE organization_id = $1 AND response_category = 'immediate') AS critical_cases,
                (SELECT AVG(data_quality_confidence) FROM integrity_cases
                 WHERE organization_id = $1 AND data_quality_confidence IS NOT NULL) AS case_data_quality_confidence`,
            [orgId],
        ),
        pool.query(
            `SELECT c.id, c.anomaly_key, c.title, c.response_category, c.stage, c.due_at,
                    c.data_quality_confidence, u.username AS owner
             FROM integrity_cases c
             LEFT JOIN users u ON u.id = c.owner_id AND u.organization_id = c.organization_id
             WHERE c.organization_id = $1
             ORDER BY CASE c.response_category
                          WHEN 'immediate' THEN 0
                          WHEN 'engineering_review' THEN 1
                          WHEN 'scheduled' THEN 2
                          WHEN 'monitor' THEN 3
                          ELSE 4
                      END,
                      c.updated_at DESC,
                      c.id DESC
             LIMIT 5`,
            [orgId],
        ),
    ]);

    if (!primaryPipeline) {
        return {
            primaryPipeline: null,
            operational: operationalResult.rows[0] || {},
            latestRun: null,
            heatmapRows: [],
            corridorRows: [],
            findingRows: findingResult.rows,
        };
    }

    const latestRunResult = await pool.query(
        `SELECT sr.id, sr.vendor, sr.survey_year, sr.uploaded_at,
                COUNT(f.id) AS feature_count,
                MAX(f.log_distance_m) AS measured_length_m
         FROM survey_runs sr
         JOIN pipelines p ON p.id = sr.pipeline_id AND p.organization_id = $2
         LEFT JOIN ili_features f
           ON f.run_id = sr.id
          AND f.log_distance_m >= 0
          AND f.log_distance_m < 'Infinity'::double precision
         WHERE sr.pipeline_id = $1
         GROUP BY sr.id, sr.vendor, sr.survey_year, sr.uploaded_at
         ORDER BY sr.uploaded_at DESC NULLS LAST, sr.id DESC
         LIMIT 1`,
        [primaryPipeline.id, orgId],
    );
    const latestRun = latestRunResult.rows[0] || null;

    if (!latestRun || Number(latestRun.measured_length_m) <= 0) {
        return {
            primaryPipeline: { ...primaryPipeline, measured_length_m: null },
            operational: operationalResult.rows[0] || {},
            latestRun,
            heatmapRows: [],
            corridorRows: [],
            findingRows: findingResult.rows,
        };
    }

    const [heatmapResult, corridorResult] = await Promise.all([
        pool.query(
            `WITH feature_counts AS (
                 SELECT COALESCE(NULLIF(btrim(f.feature_type), ''), 'Other') AS feature_type,
                        COUNT(*) AS feature_count
                 FROM ili_features f
                 WHERE f.run_id = $1
                   AND f.log_distance_m >= 0
                   AND f.log_distance_m < 'Infinity'::double precision
                 GROUP BY COALESCE(NULLIF(btrim(f.feature_type), ''), 'Other')
                 ORDER BY feature_count DESC, feature_type ASC
                 LIMIT 5
             )
             SELECT COALESCE(NULLIF(btrim(f.feature_type), ''), 'Other') AS feature_type,
                    LEAST(23, floor((f.log_distance_m / $2) * 24)::integer) AS bucket_index,
                    MAX(f.depth_pct) AS max_depth_pct
             FROM ili_features f
             JOIN feature_counts fc
               ON fc.feature_type = COALESCE(NULLIF(btrim(f.feature_type), ''), 'Other')
             JOIN survey_runs sr ON sr.id = f.run_id
             JOIN pipelines p ON p.id = sr.pipeline_id AND p.organization_id = $3
             WHERE f.run_id = $1
               AND f.log_distance_m >= 0
               AND f.log_distance_m < 'Infinity'::double precision
             GROUP BY COALESCE(NULLIF(btrim(f.feature_type), ''), 'Other'), bucket_index
             ORDER BY feature_type ASC, bucket_index ASC`,
            [latestRun.id, Number(latestRun.measured_length_m), orgId],
        ),
        pool.query(
            `SELECT f.id, f.feature_id, f.log_distance_m, f.feature_type, f.depth_pct
             FROM ili_features f
             JOIN survey_runs sr ON sr.id = f.run_id
             JOIN pipelines p ON p.id = sr.pipeline_id AND p.organization_id = $2
             WHERE f.run_id = $1
               AND f.depth_pct IS NOT NULL
               AND f.depth_pct >= 20
               AND f.log_distance_m >= 0
               AND f.log_distance_m < 'Infinity'::double precision
             ORDER BY f.depth_pct DESC, f.log_distance_m ASC, f.id ASC
             LIMIT 5`,
            [latestRun.id, orgId],
        ),
    ]);

    return {
        primaryPipeline: { ...primaryPipeline, measured_length_m: latestRun.measured_length_m },
        operational: operationalResult.rows[0] || {},
        latestRun,
        heatmapRows: heatmapResult.rows,
        corridorRows: corridorResult.rows,
        findingRows: findingResult.rows,
    };
}

module.exports = { getDashboardOverviewRows };
