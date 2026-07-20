import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveNextAction,
  formatMeasuredPercent,
  normalizeDashboardStats,
  selectJobTimestamp,
} from '../src/domain/dashboard.ts';

test('normalizeDashboardStats preserves unavailable engineering metrics as null', () => {
  const stats = normalizeDashboardStats({
    kpi: {
      totalIliRuns: 3,
      averageMatchRate: null,
      unmatchedFeatures: 0,
      averageConfidence: null,
      confidenceStatus: 'unavailable',
    },
    recentJobs: [],
  });

  assert.equal(stats.kpi.totalIliRuns, 3);
  assert.equal(stats.kpi.averageMatchRate, null);
  assert.equal(stats.kpi.averageConfidence, null);
  assert.equal(formatMeasuredPercent(stats.kpi.averageConfidence), 'Not measured');
});

test('deriveNextAction points to the first evidence-backed workflow gap', () => {
  const empty = normalizeDashboardStats({ kpi: {}, recentJobs: [] });
  assert.deepEqual(deriveNextAction(empty), {
    label: 'Import an ILI run',
    description: 'Create a canonical, auditable inspection run before starting assessment.',
    path: '/runs',
  });

  const review = normalizeDashboardStats({
    kpi: { totalIliRuns: 2, unmatchedFeatures: 4 },
    recentJobs: [{ id: 1, pipeline: 'Line A', status: 'completed', matchRate: 70 }],
  });
  assert.equal(deriveNextAction(review).path, '/ili-comparison');
});

test('normalizeDashboardStats rejects non-finite and negative counters', () => {
  const stats = normalizeDashboardStats({
    kpi: {
      totalIliRuns: -1,
      averageMatchRate: 'invalid',
      unmatchedFeatures: Number.POSITIVE_INFINITY,
      averageConfidence: 89.123,
    },
    recentJobs: [],
  });

  assert.equal(stats.kpi.totalIliRuns, 0);
  assert.equal(stats.kpi.unmatchedFeatures, 0);
  assert.equal(stats.kpi.averageMatchRate, null);
  assert.equal(formatMeasuredPercent(stats.kpi.averageConfidence), '89.1%');
});

test('selectJobTimestamp prefers measured completion time without inventing a label', () => {
  assert.equal(
    selectJobTimestamp({ startedAt: '2026-07-16T01:00:00.000Z', completedAt: '2026-07-16T01:05:00.000Z' }),
    '2026-07-16T01:05:00.000Z',
  );
  assert.equal(selectJobTimestamp({ startedAt: null, completedAt: null }), null);
});

test('normalizeDashboardStats preserves the optional operational overview', () => {
  const stats = normalizeDashboardStats({
    kpi: {},
    recentJobs: [],
    overview: {
      primaryPipeline: {
        id: 3,
        name: 'East Kalimantan Transmission Line',
        measuredLengthM: 482600,
        runCount: 2,
      },
      metrics: {
        activeIngestionJobs: 1,
        criticalCases: 2,
        dataQualityConfidencePct: 87.5,
      },
      latestRun: {
        id: 7,
        vendor: 'MFL + Caliper',
        surveyYear: 2025,
        uploadedAt: '2026-07-18T01:00:00.000Z',
        featureCount: 846,
        measuredLengthM: 482600,
      },
      heatmap: [{
        featureType: 'Corrosion',
        cells: [{ bucket: 0, severity: 'critical' }],
      }],
      corridorMarkers: [{
        id: '11',
        chainageM: 276800,
        featureType: 'Metal Loss',
        severity: 'high',
      }],
      recentFindings: [{
        id: 9,
        anomalyKey: 'KPC-03+276.8',
        title: 'Metal loss requires review',
        responseCategory: 'immediate',
        stage: 'assess',
        dueAt: '2026-07-20T01:00:00.000Z',
        owner: 'Rizki',
        confidencePct: 90,
      }],
    },
  });

  assert.equal(stats.overview.primaryPipeline.name, 'East Kalimantan Transmission Line');
  assert.equal(stats.overview.metrics.dataQualityConfidencePct, 87.5);
  assert.equal(stats.overview.latestRun?.featureCount, 846);
  assert.equal(stats.overview.heatmap[0].cells[0].severity, 'critical');
  assert.equal(stats.overview.corridorMarkers[0].chainageM, 276800);
  assert.equal(stats.overview.recentFindings[0].confidencePct, 90);
});

test('normalizeDashboardStats uses safe empty overview values for incomplete responses', () => {
  const stats = normalizeDashboardStats({ kpi: {}, recentJobs: [], overview: { metrics: { activeIngestionJobs: -1 } } });

  assert.equal(stats.overview.primaryPipeline.name, null);
  assert.equal(stats.overview.primaryPipeline.measuredLengthM, null);
  assert.equal(stats.overview.metrics.activeIngestionJobs, 0);
  assert.equal(stats.overview.metrics.dataQualityConfidencePct, null);
  assert.equal(stats.overview.latestRun, null);
  assert.deepEqual(stats.overview.heatmap, []);
});
