export type DashboardJob = {
  id: number | string;
  pipeline: string;
  runs: string | null;
  status: string;
  matchRate: number | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type DashboardSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type DashboardOverview = {
  primaryPipeline: {
    id: number | null;
    name: string | null;
    measuredLengthM: number | null;
    runCount: number;
  };
  metrics: {
    activeIngestionJobs: number;
    criticalCases: number;
    dataQualityConfidencePct: number | null;
  };
  latestRun: {
    id: number | null;
    vendor: string | null;
    surveyYear: number | null;
    uploadedAt: string | null;
    featureCount: number;
    measuredLengthM: number | null;
  } | null;
  heatmap: Array<{
    featureType: string;
    cells: Array<{ bucket: number; severity: DashboardSeverity }>;
  }>;
  corridorMarkers: Array<{
    id: string;
    chainageM: number;
    featureType: string;
    severity: Exclude<DashboardSeverity, 'none'>;
  }>;
  recentFindings: Array<{
    id: number;
    anomalyKey: string;
    title: string;
    responseCategory: string | null;
    stage: string;
    dueAt: string | null;
    owner: string | null;
    confidencePct: number | null;
  }>;
};

export type DashboardStats = {
  kpi: {
    totalIliRuns: number;
    averageMatchRate: number | null;
    unmatchedFeatures: number;
    averageConfidence: number | null;
    confidenceStatus: string;
  };
  recentJobs: DashboardJob[];
  overview: DashboardOverview;
};

export type DashboardAction = {
  label: string;
  description: string;
  path: string;
};

const EMPTY_STATS: DashboardStats = {
  kpi: {
    totalIliRuns: 0,
    averageMatchRate: null,
    unmatchedFeatures: 0,
    averageConfidence: null,
    confidenceStatus: 'unavailable',
  },
  recentJobs: [],
  overview: {
    primaryPipeline: { id: null, name: null, measuredLengthM: null, runCount: 0 },
    metrics: { activeIngestionJobs: 0, criticalCases: 0, dataQualityConfidencePct: null },
    latestRun: null,
    heatmap: [],
    corridorMarkers: [],
    recentFindings: [],
  },
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function percentage(value: unknown): number | null {
  const parsed = nonNegativeNumber(value);
  return parsed !== null && parsed <= 100 ? parsed : null;
}

function severity(value: unknown): DashboardSeverity {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical' ? value : 'none';
}

function normalizeOverview(input: unknown): DashboardOverview {
  const overview = record(input);
  const primaryPipeline = record(overview.primaryPipeline);
  const metrics = record(overview.metrics);
  const latestRun = record(overview.latestRun);
  const heatmap = Array.isArray(overview.heatmap) ? overview.heatmap : [];
  const corridorMarkers = Array.isArray(overview.corridorMarkers) ? overview.corridorMarkers : [];
  const recentFindings = Array.isArray(overview.recentFindings) ? overview.recentFindings : [];

  return {
    primaryPipeline: {
      id: positiveInteger(primaryPipeline.id),
      name: nullableText(primaryPipeline.name),
      measuredLengthM: nonNegativeNumber(primaryPipeline.measuredLengthM),
      runCount: nonNegativeInteger(primaryPipeline.runCount),
    },
    metrics: {
      activeIngestionJobs: nonNegativeInteger(metrics.activeIngestionJobs),
      criticalCases: nonNegativeInteger(metrics.criticalCases),
      dataQualityConfidencePct: percentage(metrics.dataQualityConfidencePct),
    },
    latestRun: overview.latestRun === null || overview.latestRun === undefined ? null : {
      id: positiveInteger(latestRun.id),
      vendor: nullableText(latestRun.vendor),
      surveyYear: positiveInteger(latestRun.surveyYear),
      uploadedAt: nullableText(latestRun.uploadedAt),
      featureCount: nonNegativeInteger(latestRun.featureCount),
      measuredLengthM: nonNegativeNumber(latestRun.measuredLengthM),
    },
    heatmap: heatmap.slice(0, 5).map((item) => {
      const row = record(item);
      const cells = Array.isArray(row.cells) ? row.cells : [];
      return {
        featureType: nullableText(row.featureType) ?? 'Other',
        cells: cells
          .map((cell) => {
            const entry = record(cell);
            const bucket = nonNegativeInteger(entry.bucket);
            return bucket !== null && bucket < 24 ? { bucket, severity: severity(entry.severity) } : null;
          })
          .filter((cell): cell is { bucket: number; severity: DashboardSeverity } => cell !== null),
      };
    }),
    corridorMarkers: corridorMarkers
      .map((item) => {
        const marker = record(item);
        const markerSeverity = severity(marker.severity);
        const chainageM = nonNegativeNumber(marker.chainageM);
        const id = nullableText(marker.id);
        return markerSeverity !== 'none' && chainageM !== null && id ? {
          id,
          chainageM,
          featureType: nullableText(marker.featureType) ?? 'Other',
          severity: markerSeverity,
        } : null;
      })
      .filter((marker): marker is DashboardOverview['corridorMarkers'][number] => marker !== null),
    recentFindings: recentFindings
      .map((item) => {
        const finding = record(item);
        const id = positiveInteger(finding.id);
        return id === null ? null : {
          id,
          anomalyKey: nullableText(finding.anomalyKey) ?? 'Not recorded',
          title: nullableText(finding.title) ?? 'Untitled integrity case',
          responseCategory: nullableText(finding.responseCategory),
          stage: nullableText(finding.stage) ?? 'not-recorded',
          dueAt: nullableText(finding.dueAt),
          owner: nullableText(finding.owner),
          confidencePct: percentage(finding.confidencePct),
        };
      })
      .filter((finding): finding is DashboardOverview['recentFindings'][number] => finding !== null),
  };
}

export function formatMeasuredPercent(value: number | null): string {
  return value === null ? 'Not measured' : `${value.toFixed(1)}%`;
}

export function selectJobTimestamp(job: Pick<DashboardJob, 'startedAt' | 'completedAt'>): string | null {
  return job.completedAt ?? job.startedAt;
}

export function deriveNextAction(stats: DashboardStats): DashboardAction {
  if (stats.kpi.totalIliRuns === 0) {
    return {
      label: 'Import an ILI run',
      description: 'Create a canonical, auditable inspection run before starting assessment.',
      // The import step lives inside the alignment wizard; there is no separate
      // registry page to send the engineer to.
      path: '/alignment',
    };
  }
  if (stats.kpi.unmatchedFeatures > 0) {
    return {
      label: 'Review unmatched features',
      description: `${stats.kpi.unmatchedFeatures} features require disposition before downstream assessment.`,
      path: '/ili-comparison',
    };
  }
  if (stats.recentJobs.length === 0) {
    return {
      label: 'Run spatial alignment',
      description: 'Lock the master axis and conserve every feature across inspection runs.',
      path: '/alignment',
    };
  }
  return {
    label: 'Start B31G screening',
    description: 'Evaluate aligned corrosion observations with explicit method provenance.',
    path: '/ffs',
  };
}

export function normalizeDashboardStats(input: unknown): DashboardStats {
  const root = record(input);
  const kpi = record(root.kpi);
  const jobs = Array.isArray(root.recentJobs) ? root.recentJobs : [];

  return {
    kpi: {
      totalIliRuns: nonNegativeInteger(kpi.totalIliRuns),
      averageMatchRate: finiteNumber(kpi.averageMatchRate),
      unmatchedFeatures: nonNegativeInteger(kpi.unmatchedFeatures),
      averageConfidence: finiteNumber(kpi.averageConfidence),
      confidenceStatus: nullableText(kpi.confidenceStatus) ?? EMPTY_STATS.kpi.confidenceStatus,
    },
    recentJobs: jobs.map((item, index) => {
      const job = record(item);
      return {
        id: typeof job.id === 'number' || typeof job.id === 'string' ? job.id : `job-${index}`,
        pipeline: nullableText(job.pipeline) ?? 'Unnamed pipeline',
        runs: nullableText(job.runs),
        status: nullableText(job.status) ?? 'unknown',
        matchRate: finiteNumber(job.matchRate),
        startedAt: nullableText(job.startedAt),
        completedAt: nullableText(job.completedAt),
      };
    }),
    overview: normalizeOverview(root.overview),
  };
}

export function emptyDashboardStats(): DashboardStats {
  return {
    kpi: { ...EMPTY_STATS.kpi },
    recentJobs: [],
    overview: {
      primaryPipeline: { ...EMPTY_STATS.overview.primaryPipeline },
      metrics: { ...EMPTY_STATS.overview.metrics },
      latestRun: null,
      heatmap: [],
      corridorMarkers: [],
      recentFindings: [],
    },
  };
}
