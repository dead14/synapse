/**
 * Storage for saved FFS assessments.
 *
 * Ownership is the organization on the row. An assessment that came from an
 * alignment session is additionally checked against that session's own
 * organization on the way in, so a session id from another tenant cannot be
 * attached to a local assessment.
 */

const LIST_COLUMNS = `
    f.id, f.alignment_session_id, f.pipeline_id, f.label, f.method,
    f.feature_count, f.summary_json, f.created_at,
    p.name AS pipeline_name,
    u.username AS created_by_name`;

function serializeSession(row) {
    return {
        id: String(row.id),
        alignmentSessionId: row.alignment_session_id === null ? null : String(row.alignment_session_id),
        pipelineId: row.pipeline_id === null ? null : Number(row.pipeline_id),
        pipelineName: row.pipeline_name || null,
        label: row.label,
        method: row.method || null,
        featureCount: Number(row.feature_count) || 0,
        summary: row.summary_json || {},
        createdBy: row.created_by_name || null,
        createdAt: row.created_at,
    };
}

/**
 * True when the alignment session exists and belongs to this organization.
 * Sessions carry their own organization and fall back to their pipeline's,
 * the same resolution the rest of the alignment module uses.
 */
async function alignmentSessionBelongsToOrg(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT s.id, s.pipeline_id
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1
           AND COALESCE(s.organization_id, p.organization_id) = $2`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function insertFfsSession(pool, {
    orgId,
    userId,
    alignmentSessionId,
    pipelineId,
    label,
    method,
    featureCount,
    summary,
    state,
}) {
    const result = await pool.query(
        `INSERT INTO ffs_sessions
            (organization_id, alignment_session_id, pipeline_id, label, method,
             feature_count, summary_json, state_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
         RETURNING id, created_at`,
        [
            orgId,
            alignmentSessionId,
            pipelineId,
            label,
            method,
            featureCount,
            JSON.stringify(summary || {}),
            JSON.stringify(state),
            userId ?? null,
        ],
    );
    return result.rows[0];
}

/**
 * Re-files an assessment in place. Returns null when this organization does not
 * own the session, which the caller reports as "not found" rather than as a
 * permission error — the two are indistinguishable to a caller who should never
 * have known the row existed.
 */
async function updateOwnedFfsSession(pool, sessionId, orgId, {
    label,
    method,
    featureCount,
    summary,
    state,
}) {
    const result = await pool.query(
        `UPDATE ffs_sessions
            SET label = $3,
                method = $4,
                feature_count = $5,
                summary_json = $6::jsonb,
                state_json = $7::jsonb
          WHERE id = $1 AND organization_id = $2
      RETURNING id, created_at`,
        [
            sessionId,
            orgId,
            label,
            method,
            featureCount,
            JSON.stringify(summary || {}),
            JSON.stringify(state),
        ],
    );
    return result.rows[0] || null;
}

async function listFfsSessions(pool, orgId, { limit }) {
    const result = await pool.query(
        `SELECT ${LIST_COLUMNS}
         FROM ffs_sessions f
         LEFT JOIN pipelines p ON p.id = f.pipeline_id
         LEFT JOIN users u ON u.id = f.created_by
         WHERE f.organization_id = $1
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT $2`,
        [orgId, limit],
    );
    return result.rows.map(serializeSession);
}

/** The stored case, for re-opening the results workspace or exporting it. */
async function getOwnedFfsSession(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT ${LIST_COLUMNS}, f.state_json
         FROM ffs_sessions f
         LEFT JOIN pipelines p ON p.id = f.pipeline_id
         LEFT JOIN users u ON u.id = f.created_by
         WHERE f.id = $1 AND f.organization_id = $2`,
        [sessionId, orgId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ...serializeSession(row), state: row.state_json };
}

async function deleteOwnedFfsSession(pool, sessionId, orgId) {
    const result = await pool.query(
        'DELETE FROM ffs_sessions WHERE id = $1 AND organization_id = $2 RETURNING id',
        [sessionId, orgId],
    );
    return result.rowCount > 0;
}

module.exports = {
    alignmentSessionBelongsToOrg,
    deleteOwnedFfsSession,
    getOwnedFfsSession,
    insertFfsSession,
    listFfsSessions,
    serializeSession,
    updateOwnedFfsSession,
};
