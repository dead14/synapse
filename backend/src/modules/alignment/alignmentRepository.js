const metrics = require('../../observability/metrics');

function toJson(value) {
    return JSON.stringify(value ?? {});
}

async function findOwnedSession(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT s.id, s.pipeline_id, s.started_at, s.completed_at, s.status, s.params_json,
                s.xmin::text AS revision,
                s.organization_id, s.created_by
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1
           AND COALESCE(s.organization_id, p.organization_id) = $2`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function findLatestOwnedSession(pool, orgId, { requireData = false, status = null } = {}) {
    const values = [orgId];
    const filters = ['COALESCE(s.organization_id, p.organization_id) = $1'];
    if (requireData) {
        filters.push("s.params_json IS NOT NULL", "s.params_json::text != 'null'");
    }
    if (status) {
        values.push(status);
        filters.push(`s.status = $${values.length}`);
    }

    const result = await pool.query(
        `SELECT s.id, s.pipeline_id, s.started_at, s.completed_at, s.status, s.params_json,
                s.xmin::text AS revision,
                s.organization_id, s.created_by
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE ${filters.join('\n           AND ')}
         ORDER BY s.started_at DESC
         LIMIT 1`,
        values,
    );
    return result.rows[0] || null;
}

async function listOwnedSessions(pool, orgId) {
    const result = await pool.query(
        `SELECT s.id, s.pipeline_id, s.started_at, s.completed_at, s.status, s.params_json,
                s.xmin::text AS revision,
                p.name AS stored_pipeline_name
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE COALESCE(s.organization_id, p.organization_id) = $1
         ORDER BY s.started_at DESC`,
        [orgId],
    );
    return result.rows;
}

async function createOwnedSession(pool, config, principal) {
    const requestedPipelineId = config?.pipelineId ?? config?.pipeline_id ?? null;
    const result = await pool.query(
        `INSERT INTO alignment_sessions
            (organization_id, created_by, pipeline_id, started_at, status, params_json)
         SELECT $1, $2, p.id, NOW(), 'in_progress', $4::jsonb
         FROM (SELECT $3::integer AS requested_id) requested
         LEFT JOIN pipelines p
           ON p.id = requested.requested_id
          AND p.organization_id = $1
         WHERE requested.requested_id IS NULL OR p.id IS NOT NULL
         RETURNING id, status, params_json, xmin::text AS revision`,
        [principal.orgId, principal.id, requestedPipelineId, toJson(config)],
    );
    return result.rows[0] || null;
}

async function updateOwnedSessionConfig(pool, sessionId, orgId, config, { expectedRevision = null } = {}) {
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $2
              AND COALESCE(s.organization_id, p.organization_id) = $3
         )
         UPDATE alignment_sessions s
         SET params_json = $1::jsonb
         FROM owned
         WHERE s.id = owned.id
           AND ($4::text IS NULL OR s.xmin::text = $4::text)
         RETURNING s.id, s.status, s.xmin::text AS revision`,
        [toJson(config), sessionId, orgId, expectedRevision],
    );
    return result.rows[0] || null;
}

async function markOwnedSessionCompleted(pool, sessionId, orgId, summary) {
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $2
              AND COALESCE(s.organization_id, p.organization_id) = $3
         )
         UPDATE alignment_sessions s
         SET status = 'completed',
             completed_at = NOW(),
             params_json = (
                 COALESCE(s.params_json::jsonb, '{}'::jsonb)
                 || jsonb_build_object('resultSummary', $1::jsonb)
             )::json
         FROM owned
         WHERE s.id = owned.id
         RETURNING s.id, s.status, s.completed_at, s.params_json`,
        [toJson(summary), sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function markOwnedSessionFailed(pool, sessionId, orgId, failureReason) {
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $2
              AND COALESCE(s.organization_id, p.organization_id) = $3
         )
         UPDATE alignment_sessions s
         SET status = 'failed',
             completed_at = NOW(),
             params_json = (
                 COALESCE(s.params_json::jsonb, '{}'::jsonb)
                 || jsonb_build_object('failureReason', $1::text)
             )::json
         FROM owned
         WHERE s.id = owned.id
         RETURNING s.id, s.status, s.completed_at, s.params_json`,
        [String(failureReason || 'Alignment failed'), sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function deleteOwnedSession(pool, sessionId, orgId) {
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $1
              AND COALESCE(s.organization_id, p.organization_id) = $2
         ),
         unlinked AS (
            UPDATE alignment_links
            SET source_job_id = NULL
            WHERE source_job_id IN (SELECT id FROM owned)
            RETURNING id
         ),
         deleted_results AS (
            DELETE FROM alignment_results
            WHERE session_id IN (SELECT id FROM owned)
            RETURNING id
         )
         DELETE FROM alignment_sessions s
         USING owned
         WHERE s.id = owned.id
         RETURNING s.id`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function createAlignmentJob(pool, input) {
    const executionMetadata = JSON.stringify({
        engineVersion: input.engineVersion,
        configFingerprint: input.configFingerprint,
    });
    const result = await pool.query(
        `INSERT INTO alignment_jobs
            (job_id, session_id, organization_id, user_id, state, progress, result_json)
         VALUES ($1, $2, $3, $4, 'queued', 0, $5::jsonb)
         RETURNING *`,
        [input.jobId, input.sessionId, input.organizationId, input.userId || null, executionMetadata],
    );
    return result.rows[0] || null;
}

async function getOwnedAlignmentJob(pool, jobId, orgId) {
    const result = await pool.query(
        `SELECT * FROM alignment_jobs WHERE job_id = $1 AND organization_id = $2`,
        [jobId, orgId],
    );
    return result.rows[0] || null;
}

async function getLatestAlignmentJob(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT * FROM alignment_jobs
         WHERE session_id = $1 AND organization_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function listOwnedAlignmentResultPage(pool, sessionId, orgId, { limit, after }) {
    const startedAt = performance.now();
    const values = [sessionId, orgId, after === null ? 0 : after, limit + 1];
    const result = await pool.query(
        `WITH completed AS (
            SELECT result_json
            FROM alignment_jobs
            WHERE session_id = $1
              AND organization_id = $2
              AND state = 'completed'
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT 1
         )
         SELECT item.value AS row, item.ordinality::int AS ordinal
         FROM completed c
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.result_json->'comparison', '[]'::jsonb))
             WITH ORDINALITY AS item(value, ordinality)
         WHERE item.ordinality > $3
         ORDER BY item.ordinality ASC
         LIMIT $4`,
        values,
    );
    metrics.observe('alignment_result_query', performance.now() - startedAt, { query: 'page' });
    const hasNextPage = result.rows.length > limit;
    const rows = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const tail = rows[rows.length - 1];
    return {
        rows: rows.map((row) => row.row),
        nextCursor: hasNextPage && tail ? Number(tail.ordinal) : null,
    };
}

async function findOwnedAlignmentExport(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT j.job_id,
                jsonb_array_length(COALESCE(j.result_json->'comparison', '[]'::jsonb)) AS row_count
         FROM alignment_jobs j
         WHERE j.session_id = $1
           AND j.organization_id = $2
           AND j.state = 'completed'
         ORDER BY j.completed_at DESC NULLS LAST, j.created_at DESC
         LIMIT 1`,
        [sessionId, orgId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
        jobId: row.job_id,
        rowCount: Number(row.row_count || 0),
    };
}

async function* iterateOwnedAlignmentExportRows(
    pool,
    jobId,
    orgId,
    { batchSize = 2_000 } = {},
) {
    const fetchSize = Number.isSafeInteger(batchSize) && batchSize > 0
        ? Math.min(batchSize, 10_000)
        : 2_000;
    const client = await pool.connect();
    let transactionOpen = false;
    let cursorOpen = false;
    let completed = false;

    try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        transactionOpen = true;
        // Bind ownership values once, then read them from transaction-local
        // settings inside DECLARE (PostgreSQL does not bind FETCH/DECLARE
        // parameters consistently across drivers).
        await client.query(
            `SELECT set_config('synapse.export_job_id', $1, true),
                    set_config('synapse.export_org_id', $2, true)`,
            [String(jobId), String(orgId)],
        );
        await client.query(
            `DECLARE alignment_export_rows NO SCROLL CURSOR FOR
             WITH completed AS (
                 SELECT result_json
                 FROM alignment_jobs
                 WHERE job_id = current_setting('synapse.export_job_id')
                   AND organization_id = current_setting('synapse.export_org_id')::bigint
                   AND state = 'completed'
                 LIMIT 1
             )
             SELECT item.value AS row
             FROM completed c
             CROSS JOIN LATERAL jsonb_array_elements(
                 COALESCE(c.result_json->'comparison', '[]'::jsonb)
             ) WITH ORDINALITY AS item(value, ordinality)
             ORDER BY item.ordinality ASC`,
        );
        cursorOpen = true;

        while (true) {
            const batch = await client.query(
                `FETCH FORWARD ${fetchSize} FROM alignment_export_rows`,
            );
            if (batch.rows.length === 0) break;
            for (const item of batch.rows) yield item.row;
        }
        completed = true;
    } finally {
        if (cursorOpen) {
            await client.query('CLOSE alignment_export_rows').catch(() => {});
        }
        if (transactionOpen) {
            await client.query(completed ? 'COMMIT' : 'ROLLBACK').catch(() => {});
        }
        client.release();
    }
}

async function updateAlignmentJob(pool, jobId, patch) {
    const values = [];
    const fields = [];
    const add = (field, value) => {
        values.push(value);
        fields.push(`${field} = $${values.length}`);
    };
    if (patch.state !== undefined) add('state', patch.state);
    if (patch.progress !== undefined) add('progress', patch.progress);
    if (patch.result !== undefined) add('result_json', JSON.stringify(patch.result));
    if (patch.errorCode !== undefined) add('error_code', patch.errorCode);
    if (patch.errorMessage !== undefined) add('error_message', patch.errorMessage);
    if (patch.startedAt) add('started_at', patch.startedAt);
    if (patch.completedAt) add('completed_at', patch.completedAt);
    fields.push('updated_at = NOW()');
    values.push(jobId);
    const result = await pool.query(
        `UPDATE alignment_jobs SET ${fields.join(', ')}
         WHERE job_id = $${values.length} RETURNING *`,
        values,
    );
    return result.rows[0] || null;
}

function serializeAlignmentJob(row) {
    if (!row) return null;
    return {
        jobId: row.job_id,
        state: row.state,
        progress: Number(row.progress || 0),
        result: row.result_json || null,
        failedReason: row.error_message || null,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}

module.exports = {
    createAlignmentJob,
    findOwnedSession,
    findLatestOwnedSession,
    getLatestAlignmentJob,
    getOwnedAlignmentJob,
    findOwnedAlignmentExport,
    iterateOwnedAlignmentExportRows,
    listOwnedAlignmentResultPage,
    listOwnedSessions,
    createOwnedSession,
    updateOwnedSessionConfig,
    markOwnedSessionCompleted,
    markOwnedSessionFailed,
    deleteOwnedSession,
    serializeAlignmentJob,
    updateAlignmentJob,
};
