function asJson(value) {
    return JSON.stringify(value ?? {});
}

async function ensureOwnedPipeline(pool, { organizationId, pipelineName }) {
    const result = await pool.query(
        `INSERT INTO pipelines (organization_id, name)
         VALUES ($1, $2)
         ON CONFLICT (organization_id, lower(name)) WHERE organization_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [organizationId, pipelineName],
    );
    return result.rows[0] || null;
}

async function findOwnedPersistedRunByChecksum(pool, { organizationId, pipelineName, sourceSha256 }) {
    const result = await pool.query(
        `SELECT sr.id AS run_id, sr.row_count, sr.source_sha256, sr.ingestion_audit
         FROM survey_runs sr
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE p.organization_id = $1
           AND lower(p.name) = lower($2)
           AND sr.source_sha256 = $3
         ORDER BY sr.id DESC
         LIMIT 1`,
        [organizationId, pipelineName, sourceSha256],
    );
    return result.rows[0] || null;
}

async function isParserDictionaryReady(pool) {
    const result = await pool.query(`
        SELECT
            EXISTS (SELECT 1 FROM field_synonym_dictionary LIMIT 1) AS field_ready,
            EXISTS (SELECT 1 FROM feature_type_synonym LIMIT 1) AS feature_ready
    `);
    const row = result.rows[0] || {};
    return Boolean(row.field_ready && row.feature_ready);
}

async function createIngestionJob(pool, input) {
    const result = await pool.query(
        `INSERT INTO ingestion_jobs
            (job_id, organization_id, user_id, pipeline_name, survey_year,
             vendor, source_file, object_key, source_sha256, state, progress)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', 0)
         RETURNING *`,
        [
            input.jobId,
            input.organizationId,
            input.userId || null,
            input.pipelineName,
            input.surveyYear,
            input.vendor,
            input.sourceFile,
            input.objectKey,
            input.sourceSha256 || null,
        ],
    );
    return result.rows[0] || null;
}

async function getOwnedIngestionJob(pool, jobId, orgId) {
    const result = await pool.query(
        `SELECT * FROM ingestion_jobs
         WHERE job_id = $1 AND organization_id = $2`,
        [jobId, orgId],
    );
    return result.rows[0] || null;
}

async function updateIngestionJob(pool, jobId, patch) {
    const fields = [];
    const values = [];
    const add = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
    };

    if (patch.state !== undefined) add('state', patch.state);
    if (patch.progress !== undefined) add('progress', patch.progress);
    if (patch.runId !== undefined) add('run_id', patch.runId);
    if (patch.result !== undefined) add('result_json', asJson(patch.result));
    if (patch.errorCode !== undefined) add('error_code', patch.errorCode);
    if (patch.errorMessage !== undefined) add('error_message', patch.errorMessage);
    if (patch.startedAt) add('started_at', patch.startedAt);
    if (patch.completedAt !== undefined) add('completed_at', patch.completedAt);
    if (fields.length === 0) return getOwnedIngestionJob(pool, jobId, patch.organizationId);

    fields.push('updated_at = NOW()');
    values.push(jobId);
    const result = await pool.query(
        `UPDATE ingestion_jobs
         SET ${fields.join(', ')}
         WHERE job_id = $${values.length}
         RETURNING *`,
        values,
    );
    return result.rows[0] || null;
}

function serializeIngestionJob(row) {
    if (!row) return null;
    return {
        jobId: row.job_id,
        state: row.state,
        progress: Number(row.progress || 0),
        pipelineName: row.pipeline_name,
        surveyYear: row.survey_year,
        vendor: row.vendor,
        sourceFile: row.source_file,
        runId: row.run_id === null || row.run_id === undefined ? null : Number(row.run_id),
        result: row.result_json || null,
        errorCode: row.error_code || null,
        errorMessage: row.error_message || null,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}

module.exports = {
    createIngestionJob,
    ensureOwnedPipeline,
    findOwnedPersistedRunByChecksum,
    getOwnedIngestionJob,
    isParserDictionaryReady,
    serializeIngestionJob,
    updateIngestionJob,
};
