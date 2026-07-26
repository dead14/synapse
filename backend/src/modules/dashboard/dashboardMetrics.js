function nonNegativeCount(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function finiteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function optionalText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function percentage(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return null;
    }
    return Math.round((numerator / denominator) * 1000) / 10;
}

function isoDateTime(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeComposition(rows = []) {
    let matched = 0;
    let newFeature = 0;
    let oldFeature = 0;

    for (const row of rows) {
        const count = nonNegativeCount(row.count);
        if (row.match_status === 'Matched') matched += count;
        if (row.match_status === 'Only NEW') newFeature += count;
        if (row.match_status === 'Only OLD') oldFeature += count;
    }

    const unmatchedFeatures = newFeature + oldFeature;
    const totalFeatures = matched + unmatchedFeatures;

    return {
        matched,
        newFeature,
        oldFeature,
        unmatchedFeatures,
        totalFeatures,
        averageMatchRate: percentage(matched, totalFeatures),
        averageConfidence: null,
        confidenceStatus: 'unavailable',
    };
}

function summarizeRecentJob(row) {
    const matched = nonNegativeCount(row.matched);
    const total = nonNegativeCount(row.total);
    const hasRunYears = Number.isInteger(Number(row.old_year)) && Number.isInteger(Number(row.new_year));

    return {
        id: row.id,
        pipeline: row.pipeline,
        runs: hasRunYears ? `${Number(row.old_year)} → ${Number(row.new_year)}` : null,
        status: row.status,
        matchRate: percentage(matched, total),
        startedAt: isoDateTime(row.started_at),
        completedAt: isoDateTime(row.completed_at),
    };
}

function summarizeGrowthFinding(row) {
    return {
        id: row.id,
        featureId: row.feature_id || null,
        jointNumber: finiteNumber(row.joint_number),
        depthDifferencePct: finiteNumber(row.depth_diff),
        growthRatePctPerYear: null,
        rateStatus: 'survey_interval_required',
        reviewStatus: row.growth_flag === 'Fast' ? 'priority-review' : 'engineering-review',
    };
}

function percentFromConfidence(value) {
    const confidence = finiteNumber(value);
    if (confidence === null || confidence < 0 || confidence > 1) return null;
    return Math.round(confidence * 1000) / 10;
}

function severityForDepth(value) {
    const depth = finiteNumber(value);
    if (depth === null || depth < 0) return 'none';
    if (depth < 20) return 'low';
    if (depth < 40) return 'medium';
    if (depth < 60) return 'high';
    return 'critical';
}

function summarizeHeatmap(rows = []) {
    const byFeatureType = new Map();
    for (const row of rows) {
        const featureType = optionalText(row.feature_type) || 'Other';
        const bucket = Number.parseInt(row.bucket_index, 10);
        if (!Number.isInteger(bucket) || bucket < 0 || bucket >= 24) continue;
        if (!byFeatureType.has(featureType)) {
            byFeatureType.set(featureType, Array.from({ length: 24 }, (_, index) => ({
                bucket: index,
                severity: 'none',
            })));
        }
        byFeatureType.get(featureType)[bucket].severity = severityForDepth(row.max_depth_pct);
    }
    return [...byFeatureType.entries()].map(([featureType, cells]) => ({ featureType, cells }));
}

function summarizeDashboardOverview({
    primaryPipeline,
    operational,
    latestRun,
    heatmapRows = [],
    corridorRows = [],
    findingRows = [],
} = {}) {
    const pipeline = primaryPipeline || {};
    const operationalMetrics = operational || {};
    const latest = latestRun || null;

    return {
        primaryPipeline: {
            id: Number.isSafeInteger(Number(pipeline.id)) && Number(pipeline.id) > 0 ? Number(pipeline.id) : null,
            name: optionalText(pipeline.name),
            measuredLengthM: finiteNumber(pipeline.measured_length_m),
            runCount: nonNegativeCount(pipeline.run_count),
        },
        metrics: {
            activeIngestionJobs: nonNegativeCount(operationalMetrics.active_ingestion_jobs),
            criticalCases: nonNegativeCount(operationalMetrics.critical_cases),
            dataQualityConfidencePct: percentFromConfidence(operationalMetrics.case_data_quality_confidence),
        },
        latestRun: latest ? {
            id: Number.isSafeInteger(Number(latest.id)) && Number(latest.id) > 0 ? Number(latest.id) : null,
            vendor: optionalText(latest.vendor),
            surveyYear: Number.isInteger(Number(latest.survey_year)) ? Number(latest.survey_year) : null,
            uploadedAt: isoDateTime(latest.uploaded_at),
            featureCount: nonNegativeCount(latest.feature_count),
            measuredLengthM: finiteNumber(latest.measured_length_m),
        } : null,
        heatmap: summarizeHeatmap(heatmapRows),
        corridorMarkers: corridorRows
            .map((row) => ({
                id: String(row.id),
                chainageM: finiteNumber(row.log_distance_m),
                featureType: optionalText(row.feature_type) || 'Other',
                severity: severityForDepth(row.depth_pct),
            }))
            .filter((marker) => marker.chainageM !== null && marker.severity !== 'none'),
        recentFindings: findingRows
            .map((row) => ({
                id: Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0 ? Number(row.id) : null,
                anomalyKey: optionalText(row.anomaly_key) || 'Not recorded',
                title: optionalText(row.title) || 'Untitled integrity case',
                responseCategory: optionalText(row.response_category),
                stage: optionalText(row.stage) || 'not-recorded',
                dueAt: isoDateTime(row.due_at),
                owner: optionalText(row.owner),
                confidencePct: percentFromConfidence(row.data_quality_confidence),
            }))
            .filter((finding) => finding.id !== null),
    };
}

module.exports = {
    summarizeComposition,
    summarizeDashboardOverview,
    summarizeRecentJob,
    summarizeGrowthFinding,
};
