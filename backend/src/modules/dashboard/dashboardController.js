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

        // 2. Feature Composition & Match Rate
        const compRes = await pool.query(
            `SELECT r.match_status, COUNT(r.id) as count 
             FROM alignment_results r
             JOIN alignment_sessions s ON r.session_id = s.id
             JOIN pipelines p ON s.pipeline_id = p.id
             WHERE p.organization_id = $1
             GROUP BY r.match_status`,
            [orgId]
        );
        
        const composition = summarizeComposition(compRes.rows);

        // 3. Growth Analysis Highlights (Top 5 Anomalies by depth_diff)
        const growthRes = await pool.query(
            `SELECT r.id, f.feature_id, f.joint_number, r.depth_diff, r.growth_flag
             FROM alignment_results r
             JOIN ili_features f ON r.feature_old_id = f.id
             JOIN alignment_sessions s ON r.session_id = s.id
             JOIN pipelines p ON s.pipeline_id = p.id
             WHERE p.organization_id = $1 AND r.match_status = 'Matched' AND r.depth_diff IS NOT NULL
             ORDER BY r.depth_diff DESC
             LIMIT 5`,
            [orgId]
        );
        const growthAnalysis = growthRes.rows.map(summarizeGrowthFinding);

        // 4. Recent Alignment Jobs
        const jobsRes = await pool.query(
            `SELECT s.id, p.name as pipeline, s.status, s.started_at, s.completed_at,
                    old_run.survey_year AS old_year,
                    new_run.survey_year AS new_year,
                    (SELECT COUNT(*) FROM alignment_results WHERE session_id = s.id AND match_status = 'Matched') as matched,
                    (SELECT COUNT(*) FROM alignment_results WHERE session_id = s.id) as total
             FROM alignment_sessions s
             JOIN pipelines p ON s.pipeline_id = p.id
             LEFT JOIN survey_runs old_run ON old_run.id = s.run_old_id
             LEFT JOIN survey_runs new_run ON new_run.id = s.run_new_id
             WHERE p.organization_id = $1
             ORDER BY s.started_at DESC
             LIMIT 5`,
            [orgId]
        );
        const recentJobs = jobsRes.rows.map(summarizeRecentJob);

        // 5. Measured monthly trend. Empty history remains empty; it is never fabricated.
        const trendRes = await pool.query(
            `SELECT date_trunc('month', s.completed_at) AS month,
                    COUNT(r.id) FILTER (WHERE r.match_status = 'Matched') AS matched,
                    COUNT(r.id) AS total
             FROM alignment_sessions s
             JOIN pipelines p ON s.pipeline_id = p.id
             LEFT JOIN alignment_results r ON r.session_id = s.id
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
