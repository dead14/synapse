export type InspectionProvenance = {
  sourceSha256: string | null;
  parserVersion: string | null;
  schemaVersion: string | null;
};

export type InspectionEvidence = {
  status: 'ready' | 'review' | 'unavailable';
  sourceRows: number | null;
  acceptedRows: number;
  rejectedRows: number;
  mappedColumns: number | null;
  recognizedHeaderFields: number | null;
  warningCount: number;
};

export type InspectionWorkflow = {
  /**
   * `ffs` means features were released to fitness-for-service; `assessed` means
   * an FFS run was completed and filed as its own session. Only the latter can
   * produce an FFS report.
   */
  stage: 'imported' | 'alignment' | 'runcomp' | 'ffs' | 'assessed';
  alignmentSessionId: number | null;
  /** The newest filed FFS assessment for this run's alignment session. */
  ffsSessionId: number | null;
  /** A completed alignment result the workbook can be built from. */
  downloadAvailable: boolean;
};

export type InspectionRun = {
  id: number;
  pipelineId: number;
  pipelineName: string;
  surveyYear: number | null;
  vendor: string | null;
  sourceFile: string | null;
  uploadedAt: string | null;
  rowCount: number;
  provenance: InspectionProvenance;
  evidence: InspectionEvidence;
  workflow: InspectionWorkflow;
};

export type InspectionPage = {
  items: InspectionRun[];
  nextCursor: string | null;
};

export type InspectionProfile = {
  runId: number;
  featureCount: number;
  distanceRangeM: { minimum: number | null; maximum: number | null };
  coverage: {
    depthPercent: number | null;
    wallThicknessPercent: number | null;
    clockPositionPercent: number | null;
  };
  invalid: { missingFeatureType: number; depthOutOfRange: number };
};

type ImportCandidate = {
  pipelineName: string;
  vendor: string;
  surveyYear: string | number;
  file: { name: string; size: number } | null;
};

type ImportValidation = { ok: true; year: number; error?: undefined }
  | { ok: false; error: string; year?: undefined };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function nullableNonNegativeInteger(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? Math.trunc(parsed) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStatus(value: unknown): InspectionEvidence['status'] {
  return value === 'ready' || value === 'review' ? value : 'unavailable';
}

function normalizeWorkflowStage(value: unknown): InspectionWorkflow['stage'] {
  return value === 'alignment' || value === 'runcomp' || value === 'ffs' || value === 'assessed'
    ? value
    : 'imported';
}

function normalizeInspectionRun(value: unknown): InspectionRun {
  const run = record(value);
  const provenance = record(run.provenance);
  const evidence = record(run.evidence);
  const workflow = record(run.workflow);
  const stage = normalizeWorkflowStage(workflow.stage);
  const alignmentSessionId = nullableNonNegativeInteger(workflow.alignmentSessionId);

  return {
    id: nonNegativeInteger(run.id),
    pipelineId: nonNegativeInteger(run.pipelineId),
    pipelineName: text(run.pipelineName) ?? 'Unnamed pipeline',
    surveyYear: nullableNonNegativeInteger(run.surveyYear),
    vendor: text(run.vendor),
    sourceFile: text(run.sourceFile),
    uploadedAt: text(run.uploadedAt),
    rowCount: nonNegativeInteger(run.rowCount),
    provenance: {
      sourceSha256: text(provenance.sourceSha256),
      parserVersion: text(provenance.parserVersion),
      schemaVersion: text(provenance.schemaVersion),
    },
    evidence: {
      status: normalizeStatus(evidence.status),
      sourceRows: nullableNonNegativeInteger(evidence.sourceRows),
      acceptedRows: nonNegativeInteger(evidence.acceptedRows),
      rejectedRows: nonNegativeInteger(evidence.rejectedRows),
      mappedColumns: nullableNonNegativeInteger(evidence.mappedColumns),
      recognizedHeaderFields: nullableNonNegativeInteger(evidence.recognizedHeaderFields),
      warningCount: nonNegativeInteger(evidence.warningCount),
    },
    workflow: {
      stage,
      alignmentSessionId,
      ffsSessionId: nullableNonNegativeInteger(workflow.ffsSessionId),
      downloadAvailable: (stage === 'runcomp' || stage === 'ffs' || stage === 'assessed')
        && workflow.downloadAvailable === true
        && alignmentSessionId !== null,
    },
  };
}

export function normalizeInspectionPage(value: unknown): InspectionPage {
  const page = record(value);
  return {
    items: Array.isArray(page.items) ? page.items.map(normalizeInspectionRun) : [],
    nextCursor: text(page.nextCursor),
  };
}

export function normalizeInspectionProfile(value: unknown): InspectionProfile {
  const profile = record(value);
  const range = record(profile.distanceRangeM);
  const coverage = record(profile.coverage);
  const invalid = record(profile.invalid);
  return {
    runId: nonNegativeInteger(profile.runId),
    featureCount: nonNegativeInteger(profile.featureCount),
    distanceRangeM: {
      minimum: finite(range.minimum),
      maximum: finite(range.maximum),
    },
    coverage: {
      depthPercent: finite(coverage.depthPercent),
      wallThicknessPercent: finite(coverage.wallThicknessPercent),
      clockPositionPercent: finite(coverage.clockPositionPercent),
    },
    invalid: {
      missingFeatureType: nonNegativeInteger(invalid.missingFeatureType),
      depthOutOfRange: nonNegativeInteger(invalid.depthOutOfRange),
    },
  };
}

export function summarizeInspectionRegistry(items: InspectionRun[]) {
  const pipelineKeys = new Set(items.map((item) => (
    item.pipelineId > 0 ? `id:${item.pipelineId}` : `name:${item.pipelineName}`
  )));
  return items.reduce((summary, item) => ({
    ...summary,
    acceptedRows: summary.acceptedRows + item.evidence.acceptedRows,
    rejectedRows: summary.rejectedRows + item.evidence.rejectedRows,
    reviewCount: summary.reviewCount + (item.evidence.status === 'review' ? 1 : 0),
  }), {
    runCount: items.length,
    pipelineCount: pipelineKeys.size,
    acceptedRows: 0,
    rejectedRows: 0,
    reviewCount: 0,
  });
}

export function validateInspectionImport(candidate: ImportCandidate): ImportValidation {
  const pipelineName = candidate.pipelineName.trim();
  if (!pipelineName || pipelineName.length > 120) {
    return { ok: false, error: 'Pipeline name is required and limited to 120 characters.' };
  }
  const vendor = candidate.vendor.trim();
  if (!vendor || vendor.length > 120) {
    return { ok: false, error: 'Vendor is required and limited to 120 characters.' };
  }
  const year = Number(candidate.surveyYear);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return { ok: false, error: 'Survey year must be an integer between 1900 and 2100.' };
  }
  if (!candidate.file) return { ok: false, error: 'Choose a CSV or XLSX inspection file.' };
  if (!/\.(csv|xlsx)$/i.test(candidate.file.name)) {
    return { ok: false, error: 'Inspection source must be a CSV or XLSX file.' };
  }
  if (!Number.isFinite(candidate.file.size) || candidate.file.size <= 0) {
    return { ok: false, error: 'Inspection source is empty or unreadable.' };
  }
  if (candidate.file.size > 25 * 1024 * 1024) {
    return { ok: false, error: 'Inspection source must not exceed 25 MB.' };
  }
  return { ok: true, year };
}
