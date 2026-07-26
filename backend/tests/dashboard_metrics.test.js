const test = require('node:test');
const assert = require('node:assert/strict');

const {
    summarizeComposition,
    summarizeDashboardOverview,
    summarizeRecentJob,
    summarizeGrowthFinding,
} = require('../src/modules/dashboard/dashboardMetrics');

test('summarizeComposition returns measured counts and marks unavailable confidence', () => {
    const summary = summarizeComposition([
        { match_status: 'Matched', count: '6' },
        { match_status: 'Only NEW', count: '3' },
        { match_status: 'Only OLD', count: '1' },
    ]);

    assert.deepEqual(summary, {
        matched: 6,
        newFeature: 3,
        oldFeature: 1,
        unmatchedFeatures: 4,
        totalFeatures: 10,
        averageMatchRate: 60,
        averageConfidence: null,
        confidenceStatus: 'unavailable',
    });
});

test('summarizeComposition ignores invalid and negative database counts', () => {
    const summary = summarizeComposition([
        { match_status: 'Matched', count: '-2' },
        { match_status: 'Only NEW', count: 'not-a-number' },
        { match_status: 'unknown', count: '10' },
    ]);

    assert.equal(summary.totalFeatures, 0);
    assert.equal(summary.averageMatchRate, null);
    assert.equal(summary.averageConfidence, null);
});

test('summarizeRecentJob never invents run labels or completion dates', () => {
    const job = summarizeRecentJob({
        id: 7,
        pipeline: 'North line',
        status: 'running',
        matched: '4',
        total: '8',
        started_at: new Date('2026-07-16T01:00:00.000Z'),
        completed_at: null,
        old_year: 2021,
        new_year: 2026,
    });

    assert.deepEqual(job, {
        id: 7,
        pipeline: 'North line',
        runs: '2021 → 2026',
        status: 'running',
        matchRate: 50,
        startedAt: '2026-07-16T01:00:00.000Z',
        completedAt: null,
    });
});

test('summarizeGrowthFinding reports depth delta and does not label it as a rate', () => {
    const finding = summarizeGrowthFinding({
        id: 12,
        feature_id: 'ML-12',
        joint_number: 4,
        depth_diff: '2.75',
        growth_flag: 'Fast',
    });

    assert.deepEqual(finding, {
        id: 12,
        featureId: 'ML-12',
        jointNumber: 4,
        depthDifferencePct: 2.75,
        growthRatePctPerYear: null,
        rateStatus: 'survey_interval_required',
        reviewStatus: 'priority-review',
    });
});

test('summarizeDashboardOverview keeps dashboard measurements tied to persisted evidence', () => {
    const overview = summarizeDashboardOverview({
        primaryPipeline: {
            id: 4,
            name: 'East Kalimantan Transmission Line',
            measured_length_m: '482600',
            run_count: '2',
        },
        operational: {
            active_ingestion_jobs: '1',
            critical_cases: '2',
            case_data_quality_confidence: '0.875',
        },
        latestRun: {
            id: 7,
            vendor: 'MFL + Caliper',
            survey_year: '2025',
            uploaded_at: new Date('2026-07-18T01:00:00.000Z'),
            feature_count: '846',
            measured_length_m: '482600',
        },
        heatmapRows: [
            { feature_type: 'Corrosion', bucket_index: '0', max_depth_pct: '19.9' },
            { feature_type: 'Corrosion', bucket_index: '1', max_depth_pct: '62.1' },
        ],
        corridorRows: [
            { id: 11, feature_id: 'KPC-03+276.8', log_distance_m: '276800', feature_type: 'Metal Loss', depth_pct: '45' },
        ],
        findingRows: [
            {
                id: 9,
                anomaly_key: 'KPC-03+276.8',
                title: 'Metal loss requires review',
                response_category: 'immediate',
                stage: 'assess',
                due_at: new Date('2026-07-20T01:00:00.000Z'),
                owner: 'Rizki',
                data_quality_confidence: '0.9',
            },
        ],
    });

    assert.deepEqual(overview.primaryPipeline, {
        id: 4,
        name: 'East Kalimantan Transmission Line',
        measuredLengthM: 482600,
        runCount: 2,
    });
    assert.deepEqual(overview.metrics, {
        activeIngestionJobs: 1,
        criticalCases: 2,
        dataQualityConfidencePct: 87.5,
    });
    assert.equal(overview.latestRun?.uploadedAt, '2026-07-18T01:00:00.000Z');
    assert.equal(overview.heatmap[0].cells[0].severity, 'low');
    assert.equal(overview.heatmap[0].cells[1].severity, 'critical');
    assert.deepEqual(overview.corridorMarkers, [{
        id: '11',
        chainageM: 276800,
        featureType: 'Metal Loss',
        severity: 'high',
    }]);
    assert.deepEqual(overview.recentFindings, [{
        id: 9,
        anomalyKey: 'KPC-03+276.8',
        title: 'Metal loss requires review',
        responseCategory: 'immediate',
        stage: 'assess',
        dueAt: '2026-07-20T01:00:00.000Z',
        owner: 'Rizki',
        confidencePct: 90,
    }]);
});

test('summarizeDashboardOverview exposes unavailable evidence without filling it in', () => {
    const overview = summarizeDashboardOverview({
        primaryPipeline: null,
        operational: {},
        latestRun: null,
        heatmapRows: [],
        corridorRows: [],
        findingRows: [],
    });

    assert.deepEqual(overview.primaryPipeline, {
        id: null,
        name: null,
        measuredLengthM: null,
        runCount: 0,
    });
    assert.equal(overview.metrics.dataQualityConfidencePct, null);
    assert.equal(overview.latestRun, null);
    assert.deepEqual(overview.heatmap, []);
    assert.deepEqual(overview.corridorMarkers, []);
    assert.deepEqual(overview.recentFindings, []);
});
