/**
 * Storage for API 580 assessments.
 *
 * Ownership is the organization on the row. An assessment that cites a filed FFS
 * assessment is additionally checked against that assessment's own organization
 * on the way in, so one tenant's measured evidence can never end up carrying
 * another tenant's risk ranking.
 */

const LIST_COLUMNS = `
    r.id, r.ffs_session_id, r.pipeline_id, r.label, r.status, r.current_step,
    r.summary_json, r.created_at, r.updated_at,
    p.name AS pipeline_name,
    f.label AS ffs_label,
    creator.username AS created_by_name,
    editor.username AS updated_by_name`;

const LIST_JOINS = `
    FROM rbi_sessions r
    LEFT JOIN pipelines p ON p.id = r.pipeline_id
    LEFT JOIN ffs_sessions f ON f.id = r.ffs_session_id
    LEFT JOIN users creator ON creator.id = r.created_by
    LEFT JOIN users editor ON editor.id = r.updated_by`;

function serializeSession(row) {
    return {
        id: String(row.id),
        ffsSessionId: row.ffs_session_id === null ? null : String(row.ffs_session_id),
        // Null once the cited assessment has been deleted, which the wizard
        // reports rather than papering over — an RBI whose evidence has gone is
        // a finding, not a blank field.
        ffsLabel: row.ffs_label || null,
        pipelineId: row.pipeline_id === null ? null : Number(row.pipeline_id),
        pipelineName: row.pipeline_name || null,
        label: row.label,
        status: row.status,
        currentStep: row.current_step || null,
        summary: row.summary_json || {},
        createdBy: row.created_by_name || null,
        updatedBy: row.updated_by_name || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/** True when the FFS session exists and belongs to this organization. */
async function ffsSessionBelongsToOrg(pool, ffsSessionId, orgId) {
    const result = await pool.query(
        'SELECT id, pipeline_id FROM ffs_sessions WHERE id = $1 AND organization_id = $2',
        [ffsSessionId, orgId],
    );
    return result.rows[0] || null;
}

async function insertRbiSession(pool, {
    orgId,
    userId,
    ffsSessionId,
    pipelineId,
    label,
    status,
    currentStep,
    summary,
    record,
}) {
    const result = await pool.query(
        `INSERT INTO rbi_sessions
            (organization_id, ffs_session_id, pipeline_id, label, status, current_step,
             summary_json, record_json, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $9)
         RETURNING id, created_at, updated_at`,
        [
            orgId,
            ffsSessionId,
            pipelineId,
            label,
            status,
            currentStep,
            JSON.stringify(summary || {}),
            JSON.stringify(record),
            userId ?? null,
        ],
    );
    return result.rows[0];
}

/**
 * Saves the authored document in place, stamping who touched it last. API 580
 * asks for the personnel behind an assessment to be recorded, and the last
 * editor is part of that record, not audit trivia.
 *
 * Returns null when this organization does not own the session, which the caller
 * reports as "not found" rather than as a permission error: the two are
 * indistinguishable to a caller who should never have known the row existed.
 */
async function updateOwnedRbiSession(pool, sessionId, orgId, userId, {
    label,
    status,
    currentStep,
    summary,
    record,
}) {
    const result = await pool.query(
        `UPDATE rbi_sessions
            SET label = $3,
                status = $4,
                current_step = $5,
                summary_json = $6::jsonb,
                record_json = $7::jsonb,
                updated_by = $8,
                updated_at = NOW()
          WHERE id = $1 AND organization_id = $2
      RETURNING id, created_at, updated_at`,
        [
            sessionId,
            orgId,
            label,
            status,
            currentStep,
            JSON.stringify(summary || {}),
            JSON.stringify(record),
            userId ?? null,
        ],
    );
    return result.rows[0] || null;
}

async function listRbiSessions(pool, orgId, { limit }) {
    const result = await pool.query(
        `SELECT ${LIST_COLUMNS} ${LIST_JOINS}
         WHERE r.organization_id = $1
         ORDER BY r.updated_at DESC, r.id DESC
         LIMIT $2`,
        [orgId, limit],
    );
    return result.rows.map(serializeSession);
}

/** The stored document, for re-opening the wizard or exporting the workbook. */
async function getOwnedRbiSession(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT ${LIST_COLUMNS}, r.record_json ${LIST_JOINS}
         WHERE r.id = $1 AND r.organization_id = $2`,
        [sessionId, orgId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ...serializeSession(row), record: row.record_json };
}

async function deleteOwnedRbiSession(pool, sessionId, orgId) {
    const result = await pool.query(
        'DELETE FROM rbi_sessions WHERE id = $1 AND organization_id = $2 RETURNING id',
        [sessionId, orgId],
    );
    return result.rowCount > 0;
}

module.exports = {
    deleteOwnedRbiSession,
    ffsSessionBelongsToOrg,
    getOwnedRbiSession,
    insertRbiSession,
    listRbiSessions,
    serializeSession,
    updateOwnedRbiSession,
};
