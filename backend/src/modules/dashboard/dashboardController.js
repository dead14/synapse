const pool = require('../../config/db');
const {
    summarizeComposition,
    summarizeDashboardOverview,
    summarizeRecentJob,
    summarizeGrowthFinding,
} = require('./dashboardMetrics');
const { getDashboardOverviewRows } = require('./dashboardRepository');

exports.getActivityLogs = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.id, u.username as user, a.action, a.target, a.timestamp, a.ip_address AS ip
             FROM activity_logs a
             LEFT JOIN users u ON a.user_id = u.id
             WHERE a.organization_id = $1
             ORDER BY a.timestamp DESC
             LIMIT 100`,
            [req.user.orgId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
};

exports.getDashboardStats = async (req, res) => {
    const orgId = Number(req.user?.orgId);
    if (!Number.isSafeInteger(orgId) || orgId <= 0) {
        return res.status(403).json({ error: 'Organization context is required for dashboard data' });
    }
    try {
        // 1. Total ILI Runs Terproses
        const totalRunsRes = await pool.query(
            `SELECT COUNT(s.id) as total 
             FROM survey_runs s 
             JOIN pipelines p ON s.pipeline_id = p.id 
             WHERE p.organization_id = $1`,
            [orgId]
        );
        const totalIliRuns = parseInt(totalRunsRes.rows[0].total) || 0;

        // The alignment engine never writes `alignment_results` — it builds the
        // ORM objects and discards them — so every panel below used to read an
        // empty table and report zero. The per-session summary the worker
        // records when a run completes is the authoritative count, and reading
        // it costs one small scan instead of aggregating millions of rows.
        const SESSION_SUMMARY = `s.params_json -> 'resultSummary'`;

        // 2. Feature Composition & Match Rate
        const compRes = await pool.query(
            `SELECT status.match_status, SUM(status.count)::bigint AS count
             FROM alignment_sessions s
             JOIN pipelines p ON s.pipeline_id = p.id
             CROSS JOIN LATERAL (VALUES
                 ('Matched',  COALESCE((${SESSION_SUMMARY} ->> 'matched')::numeric, 0)),
                 ('Only OLD', COALESCE((${SESSION_SUMMARY} ->> 'onlyOld')::numeric, 0)),
                 ('Only NEW', COALESCE((${SESSION_SUMMARY} ->> 'onlyNew')::numeric, 0))
             ) AS status(match_status, count)
             WHERE p.organization_id = $1
               AND ${SESSION_SUMMARY} IS NOT NULL
             GROUP BY status.match_status`,
            [orgId]
        );

        const composition = summarizeComposition(compRes.rows);

        // 3. Growth Analysis Highlights (Top 5 matched anomalies by depth change).
        // Read from the newest completed run of the organization only: the
        // dashboard needs the current worst offenders, not a scan of every run
        // ever stored.
        const growthRes = await pool.query(
            `WITH latest AS (
                 SELECT j.job_id
                 FROM alignment_jobs j
                 JOIN alignment_sessions s ON s.id = j.session_id
                 JOIN pipelines p ON p.id = s.pipeline_id
                 WHERE p.organization_id = $1 AND j.state = 'completed'
                 ORDER BY j.completed_at DESC NULLS LAST, j.created_at DESC
                 LIMIT 1
             )
             SELECT r.ordinal AS id,
                    r.row_json ->> 'Feature ID NEW' AS feature_id,
                    NULLIF(r.row_json ->> 'Joint No. NEW', '-') AS joint_number,
                    (r.row_json ->> 'Depth NEW (%WT)')::numeric
                        - (r.row_json ->> 'Depth OLD (%WT)')::numeric AS depth_diff,
                    NULL AS growth_flag
             FROM latest l
             JOIN alignment_job_rows r ON r.job_id = l.job_id
             WHERE r.row_json ->> 'Result Group' = 'ANOMALY'
               AND r.row_json ->> 'Match/Unmatch' = 'Matched'
               AND r.row_json ->> 'Depth NEW (%WT)' ~ '^-?[0-9]+(\\.[0-9]+)?$'
               AND r.row_json ->> 'Depth OLD (%WT)' ~ '^-?[0-9]+(\\.[0-9]+)?$'
             ORDER BY depth_diff DESC
             LIMIT 5`,
            [orgId]
        );
        const growthAnalysis = growthRes.rows.map(summarizeGrowthFinding);

        // 4. Recent Alignment Jobs. Survey years come from the session's own
        // summary: run_old_id / run_new_id are columns nothing ever populates,
        // so joining through them always produced a null run label.
        const jobsRes = await pool.query(
            `SELECT s.id, p.name as pipeline, s.status, s.started_at, s.completed_at,
                    NULLIF(s.params_json #>> '{summaryData,oldRun,year}', '')::numeric AS old_year,
                    NULLIF(s.params_json #>> '{summaryData,newRun,year}', '')::numeric AS new_year,
                    COALESCE((${SESSION_SUMMARY} ->> 'matched')::numeric, 0) AS matched,
                    COALESCE((${SESSION_SUMMARY} ->> 'anomaliesFound')::numeric, 0) AS total
             FROM alignment_sessions s
             JOIN pipelines p ON s.pipeline_id = p.id
             WHERE p.organization_id = $1
             ORDER BY s.started_at DESC
             LIMIT 5`,
            [orgId]
        );
        const recentJobs = jobsRes.rows.map(summarizeRecentJob);

        // 5. Measured monthly trend. Empty history remains empty; it is never fabricated.
        const trendRes = await pool.query(
            `SELECT date_trunc('month', s.completed_at) AS month,
                    SUM(COALESCE((${SESSION_SUMMARY} ->> 'matched')::numeric, 0)) AS matched,
                    SUM(COALESCE((${SESSION_SUMMARY} ->> 'anomaliesFound')::numeric, 0)) AS total
             FROM alignment_sessions s
             JOIN pipelines p ON s.pipeline_id = p.id
             WHERE p.organization_id = $1
               AND s.completed_at IS NOT NULL
             GROUP BY date_trunc('month', s.completed_at)
             ORDER BY month DESC
             LIMIT 6`,
            [orgId]
        );
        const trendData = trendRes.rows.reverse().map((row) => {
            const matchedCount = Number.parseInt(row.matched, 10) || 0;
            const totalCount = Number.parseInt(row.total, 10) || 0;
            return {
                month: row.month instanceof Date ? row.month.toISOString() : row.month,
                matchRate: totalCount > 0 ? Math.round((matchedCount / totalCount) * 1000) / 10 : null,
                confidence: null,
                confidenceStatus: 'unavailable',
            };
        });

        // 6. Map Indicators (Pipelines alignment status)
        const pipelinesRes = await pool.query(
            `SELECT id, name FROM pipelines WHERE organization_id = $1`, [orgId]
        );
        const mapIndicators = pipelinesRes.rows.map((p) => {
            const hasJob = recentJobs.find(j => j.pipeline === p.name);
            let status = 'not-assessed';
            if (hasJob) {
                status = hasJob.status === 'completed' ? 'aligned' : hasJob.status;
            }
            return {
                id: p.id,
                name: p.name,
                status: status,
                coords: null,
                locationStatus: 'unavailable'
            };
        });

        const overview = summarizeDashboardOverview(
            await getDashboardOverviewRows(pool, orgId),
        );

        res.json({
            kpi: {
                totalIliRuns,
                averageMatchRate: composition.averageMatchRate,
                unmatchedFeatures: composition.unmatchedFeatures,
                averageConfidence: composition.averageConfidence,
                confidenceStatus: composition.confidenceStatus,
            },
            featureComposition: {
                matched: composition.matched,
                unmatched: composition.unmatchedFeatures,
                newFeature: composition.newFeature,
                removedFeature: composition.oldFeature
            },
            growthAnalysis,
            recentJobs,
            trendData,
            mapIndicators,
            overview,
        });

    } catch (err) {
        console.error('Failed to fetch dashboard stats:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
};
