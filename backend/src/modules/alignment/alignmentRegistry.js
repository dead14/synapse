/**
 * One row of the ILI alignment registry.
 *
 * The registry is now the only survey-data table in the product, so a row has to
 * answer everything the removed ILI-runs page answered as well as everything the
 * alignment history answered: which two runs were compared, whether there is a
 * result to open or export, what the Corrosion Analysis review released, and
 * whether an FFS assessment was filed against it.
 *
 * Pure functions — the repository supplies the row, this module decides what it
 * means. The workflow stage in particular is derived in exactly one place, so
 * the table, the FFS handoff and the tests cannot disagree about it.
 */

/** Stages a session moves through, in order. */
const REGISTRY_STAGES = Object.freeze([
    'running',
    'failed',
    'aligned',
    'released',
    'assessed',
]);

function parseParams(row) {
    const raw = row?.params_json;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw) || {};
    } catch (_error) {
        return {};
    }
}

/**
 * A number the row may simply not have.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so a plain `Number.isFinite` guard
 * turns "this run recorded no survey year" into "surveyed in the year 0" and
 * "row count unknown" into "no rows". Absent is not zero.
 */
function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
}

/**
 * The two sides of the comparison.
 *
 * The vendor and survey year come from the persisted survey run where the
 * session points at one, and fall back to the name the wizard recorded — a
 * session built before `run_old_id` / `run_new_id` were populated still has to
 * say which runs it compared.
 */
function runFacts(summaryRun, columns) {
    const stored = summaryRun || {};
    return {
        runId: finiteNumber(columns.runId),
        name: text(stored.name) || text(columns.vendor) || null,
        vendor: text(columns.vendor) || text(stored.vendor) || null,
        surveyYear: finiteNumber(columns.surveyYear) ?? finiteNumber(stored.surveyYear),
        surveyDate: columns.surveyDate ?? text(stored.surveyDate) ?? null,
        rowCount: columns.rowCount === undefined ? null : finiteNumber(columns.rowCount),
    };
}

/**
 * What this session is waiting for.
 *
 * A failed run is held apart from a running one: both are "not completed", but
 * only one of them is going to finish on its own.
 */
function deriveStage({ status, selectedCount, ffsSessionId }) {
    if (status === 'failed') return 'failed';
    if (status !== 'completed') return 'running';
    if (ffsSessionId !== null && ffsSessionId !== undefined) return 'assessed';
    if (selectedCount > 0) return 'released';
    // A completed alignment with no review is still a complete alignment: FFS can
    // assess every anomaly it found. `aligned` is a stage, not a blocker.
    return 'aligned';
}

function serializeRegistryRow(row) {
    const params = parseParams(row);
    const summaryData = params.summaryData || {};
    const resultSummary = params.resultSummary || {};

    const oldRun = runFacts(summaryData.oldRun, {
        vendor: row.old_vendor,
        surveyYear: row.old_survey_year,
        surveyDate: row.old_survey_date ?? null,
        runId: row.run_old_id,
    });
    const newRun = runFacts(summaryData.newRun || summaryData.masterRun, {
        vendor: row.new_vendor,
        surveyYear: row.new_survey_year,
        surveyDate: row.new_survey_date ?? null,
        runId: row.run_new_id,
        rowCount: row.new_row_count,
    });

    const selectedCount = nonNegativeInteger(row.selected_count);
    const ffsSessionId = row.ffs_session_id === null || row.ffs_session_id === undefined
        ? null
        : String(row.ffs_session_id);
    const resultAvailable = Boolean(row.completed_job_id);

    return {
        id: String(row.id),
        pipelineId: row.pipeline_id === null || row.pipeline_id === undefined
            ? null
            : Number(row.pipeline_id),
        pipelineName: text(summaryData.sessionName)
            || text(summaryData.pipelineName)
            || text(row.stored_pipeline_name)
            || `Run ${row.id}`,
        algorithm: text(params.algorithm) || text(summaryData.algorithm) || null,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        matchRate: finiteNumber(resultSummary.matchRate),
        anomaliesFound: nonNegativeInteger(resultSummary.anomaliesFound),
        runs: { old: oldRun, new: newRun },
        result: {
            available: resultAvailable,
            completedAt: row.result_completed_at ?? null,
        },
        review: {
            reviewedCount: nonNegativeInteger(row.reviewed_count),
            selectedCount,
        },
        // Null until an assessment is filed. The table shows an FFS button only
        // when there is a filed assessment to open, and offers to run one
        // otherwise — the button that used to be there always led to setup.
        ffs: ffsSessionId === null ? null : {
            sessionId: ffsSessionId,
            createdAt: row.ffs_created_at ?? null,
            featureCount: nonNegativeInteger(row.ffs_feature_count),
            summary: row.ffs_summary && typeof row.ffs_summary === 'object' ? row.ffs_summary : {},
            sessionCount: nonNegativeInteger(row.ffs_session_count),
        },
        stage: deriveStage({ status: row.status, selectedCount, ffsSessionId }),
    };
}

module.exports = { REGISTRY_STAGES, deriveStage, serializeRegistryRow };
