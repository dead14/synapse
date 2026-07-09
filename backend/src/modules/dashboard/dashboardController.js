const pool = require('../../config/db');

exports.getActivityLogs = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.id, u.username as user, a.action, a.target, a.created_at as timestamp, a.ip_address
             FROM activity_logs a
             LEFT JOIN users u ON a.user_id = u.id
             WHERE a.organization_id = $1
             ORDER BY a.created_at DESC
             LIMIT 10`,
            [req.user.orgId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
};

exports.getDashboardStats = async (req, res) => {
    const orgId = req.user.orgId;
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
        
        let matched = 0, newFeature = 0, oldFeature = 0, totalFeatures = 0;
        compRes.rows.forEach(r => {
            const count = parseInt(r.count);
            totalFeatures += count;
            if (r.match_status === 'Matched') matched += count;
            else if (r.match_status === 'Only NEW') newFeature += count;
            else if (r.match_status === 'Only OLD') oldFeature += count;
        });
        
        const unmatchedFeatures = newFeature + oldFeature;
        const averageMatchRate = totalFeatures > 0 ? ((matched / totalFeatures) * 100).toFixed(1) : 0;
        
        // Mock Confidence Score (since column doesn't exist, we use a random high number or 0 if no features)
        const averageConfidence = totalFeatures > 0 ? 87.5 : 0; 

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
        const growthAnalysis = growthRes.rows.map(r => ({
            id: r.id,
            feature_id: r.feature_id || `Anomaly-${r.id}`,
            joint_number: r.joint_number || 0,
            growth_rate: parseFloat(r.depth_diff).toFixed(2),
            status: r.growth_flag === 'Fast' ? 'Critical' : 'Monitor'
        }));

        // 4. Recent Alignment Jobs
        const jobsRes = await pool.query(
            `SELECT s.id, p.name as pipeline, s.status, s.completed_at as date,
                    (SELECT COUNT(*) FROM alignment_results WHERE session_id = s.id AND match_status = 'Matched') as matched,
                    (SELECT COUNT(*) FROM alignment_results WHERE session_id = s.id) as total
             FROM alignment_sessions s
             JOIN pipelines p ON s.pipeline_id = p.id
             WHERE p.organization_id = $1
             ORDER BY s.started_at DESC
             LIMIT 5`,
            [orgId]
        );
        const recentJobs = jobsRes.rows.map(j => ({
            id: j.id,
            pipeline: j.pipeline,
            runs: `Run vs Run`,
            status: j.status,
            matchRate: j.total > 0 ? ((j.matched / j.total) * 100).toFixed(1) : 0,
            date: j.date ? j.date.toISOString().split('T')[0] : 'Processing'
        }));

        // 5. Alignment Quality Trend (Mocked 6 months trend for simplicity if db is empty)
        const trendData = [
            { label: 'Jan', matchRate: 75, confidence: 80 },
            { label: 'Feb', matchRate: 78, confidence: 82 },
            { label: 'Mar', matchRate: 82, confidence: 85 },
            { label: 'Apr', matchRate: 80, confidence: 83 },
            { label: 'May', matchRate: 85, confidence: 88 },
            { label: 'Jun', matchRate: parseFloat(averageMatchRate) || 88, confidence: averageConfidence }
        ];

        // 6. Map Indicators (Pipelines alignment status)
        const pipelinesRes = await pool.query(
            `SELECT id, name FROM pipelines WHERE organization_id = $1`, [orgId]
        );
        const mapIndicators = pipelinesRes.rows.map((p, i) => {
            const hasJob = recentJobs.find(j => j.pipeline === p.name);
            let status = 'Un-aligned'; // Yellow
            if (hasJob) {
                status = hasJob.status === 'completed' ? 'Aligned' : 'Processing';
            }
            // Add some mock lat/long for Indonesia based on index
            const coords = [
                [-6.2, 106.8], [-1.2, 116.8], [-7.2, 112.7], [1.4, 101.4]
            ];
            return {
                id: p.id,
                name: p.name,
                status: status,
                coords: coords[i % coords.length]
            };
        });

        res.json({
            kpi: {
                totalIliRuns,
                averageMatchRate,
                unmatchedFeatures,
                averageConfidence
            },
            featureComposition: {
                matched,
                unmatched: unmatchedFeatures,
                newFeature,
                removedFeature: oldFeature
            },
            growthAnalysis,
            recentJobs,
            trendData,
            mapIndicators
        });

    } catch (err) {
        console.error('Failed to fetch dashboard stats:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
};
