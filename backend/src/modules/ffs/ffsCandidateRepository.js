/**
 * Storage for the Corrosion Analysis review. Ownership is resolved the same way
 * as everywhere else in the alignment module: through the session's own
 * organization, falling back to its pipeline's.
 */

const OWNED_SESSION_CTE = `
    owned AS (
        SELECT s.id,
               COALESCE(s.organization_id, p.organization_id) AS organization_id,
               s.status,
               s.params_json
        FROM alignment_sessions s
        LEFT JOIN pipelines p ON p.id = s.pipeline_id
        WHERE s.id = $1
          AND COALESCE(s.organization_id, p.organization_id) = $2
    )`;

function serializeCandidate(row) {
    return {
        sourceKey: row.source_key_new,
        featureId: row.feature_id,
        selected: row.selected,
        reason: row.reason,
        signature: row.result_signature,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
    };
}

async function findOwnedSessionForReview(pool, sessionId, orgId) {
    const result = await pool.query(
        `WITH ${OWNED_SESSION_CTE} SELECT * FROM owned`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function listFfsCandidates(pool, sessionId, orgId) {
    const result = await pool.query(
        `WITH ${OWNED_SESSION_CTE}
         SELECT c.source_key_new, c.feature_id, c.selected, c.reason,
                c.result_signature, c.reviewed_by, c.reviewed_at
         FROM ffs_candidates c
         JOIN owned o ON o.id = c.session_id
         ORDER BY c.source_key_new`,
        [sessionId, orgId],
    );
    return result.rows.map(serializeCandidate);
}

/**
 * Every `Source Key NEW` present in the session's latest completed alignment
 * job. A review may only reference keys that exist in that result.
 *
 * A completed run keeps its rows in `alignment_job_rows` and leaves only
 * execution metadata in `result_json` (migration 012). Reading the comparison
 * array alone therefore answered "no keys at all" for every run written since,
 * and the Corrosion Analysis handoff rejected the entire released population as
 * foreign to its own result. Runs completed before that migration still carry
 * their rows inside `result_json`, so both shapes are read here — the same
 * split every other result reader uses, keyed on `row_count`.
 */
async function listResultSourceKeys(pool, sessionId, orgId) {
    const result = await pool.query(
        `WITH completed AS (
            SELECT job_id, result_json, row_count
            FROM alignment_jobs
            WHERE session_id = $1
              AND organization_id = $2
              AND state = 'completed'
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT 1
         ),
         persisted AS (
            SELECT r.row_json->>'Source Key NEW' AS source_key
            FROM completed c
            JOIN alignment_job_rows r ON r.job_id = c.job_id
            WHERE c.row_count IS NOT NULL
         ),
         legacy AS (
            SELECT item.value->>'Source Key NEW' AS source_key
            FROM completed c
            CROSS JOIN LATERAL jsonb_array_elements(
                COALESCE(c.result_json->'comparison', '[]'::jsonb)
            ) AS item(value)
            WHERE c.row_count IS NULL
         )
         SELECT DISTINCT source_key
         FROM (SELECT source_key FROM persisted
               UNION ALL
               SELECT source_key FROM legacy) keys
         WHERE COALESCE(source_key, '-') <> '-'`,
        [sessionId, orgId],
    );
    return new Set(result.rows.map((row) => row.source_key).filter(Boolean));
}

/**
 * Replaces the whole review for one session. Unselected features are stored
 * too, so "reviewed and rejected" stays distinguishable from "never reviewed".
 */
async function replaceFfsCandidates(pool, { sessionId, orgId, userId, signature, items }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `DELETE FROM ffs_candidates c
             USING alignment_sessions s
             LEFT JOIN pipelines p ON p.id = s.pipeline_id
             WHERE c.session_id = s.id
               AND s.id = $1
               AND COALESCE(s.organization_id, p.organization_id) = $2`,
            [sessionId, orgId],
        );

        if (items.length > 0) {
            await client.query(
                `INSERT INTO ffs_candidates
                    (session_id, organization_id, source_key_new, feature_id,
                     selected, reason, result_signature, reviewed_by)
                 SELECT $1, $2, entry.source_key, entry.feature_id,
                        entry.selected, entry.reason, $3, $4
                 FROM jsonb_to_recordset($5::jsonb)
                     AS entry(source_key text, feature_id text, selected boolean, reason text)`,
                [
                    sessionId,
                    orgId,
                    signature,
                    userId || null,
                    JSON.stringify(items.map((item) => ({
                        source_key: item.sourceKey,
                        feature_id: item.featureId,
                        selected: item.selected,
                        reason: item.reason,
                    }))),
                ],
            );
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    return listFfsCandidates(pool, sessionId, orgId);
}

/**
 * Completed sessions together with their review state. The caller decides
 * eligibility, because staleness needs the alignment config fingerprint.
 */
async function listReviewedSessions(pool, orgId) {
    const result = await pool.query(
        `SELECT s.id,
                s.status,
                s.params_json,
                s.completed_at,
                p.name AS stored_pipeline_name,
                COALESCE(review.selected_count, 0) AS selected_count,
                COALESCE(review.reviewed_count, 0) AS reviewed_count,
                review.reviewed_at,
                review.min_signature,
                review.max_signature
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         LEFT JOIN (
             SELECT c.session_id,
                    COUNT(c.id) FILTER (WHERE c.selected) AS selected_count,
                    COUNT(c.id) AS reviewed_count,
                    MAX(c.reviewed_at) AS reviewed_at,
                    MIN(c.result_signature) AS min_signature,
                    MAX(c.result_signature) AS max_signature
             FROM ffs_candidates c
             GROUP BY c.session_id
         ) review ON review.session_id = s.id
         WHERE COALESCE(s.organization_id, p.organization_id) = $1
           AND s.status = 'completed'
         ORDER BY s.completed_at DESC NULLS LAST, s.id DESC`,
        [orgId],
    );
    return result.rows;
}

module.exports = {
    findOwnedSessionForReview,
    listFfsCandidates,
    listResultSourceKeys,
    listReviewedSessions,
    replaceFfsCandidates,
};
