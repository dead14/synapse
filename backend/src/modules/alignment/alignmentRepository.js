function toJson(value) {
    return JSON.stringify(value ?? {});
}

async function findOwnedSession(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT s.id, s.pipeline_id, s.started_at, s.completed_at, s.status, s.params_json,
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
         RETURNING id, status, params_json`,
        [principal.orgId, principal.id, requestedPipelineId, toJson(config)],
    );
    return result.rows[0] || null;
}

async function updateOwnedSessionConfig(pool, sessionId, orgId, config) {
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
         RETURNING s.id, s.status, s.params_json`,
        [toJson(config), sessionId, orgId],
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

module.exports = {
    findOwnedSession,
    findLatestOwnedSession,
    listOwnedSessions,
    createOwnedSession,
    updateOwnedSessionConfig,
    markOwnedSessionCompleted,
    markOwnedSessionFailed,
    deleteOwnedSession,
};
