const {
    ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL,
    canonicalAlignmentAnchorType,
} = require('./alignmentAnchorTypes');

// The controller's direct feature and result lookups.  Kept apart from
// alignmentRepository so the session/job SQL and the anchor-loading SQL can
// evolve independently; every query stays organization-scoped through the
// owning pipeline exactly as it was inline.
const MAX_DTW_ANCHORS = Number(process.env.MAX_DTW_RECORDS) || 25_000;

function toCanonicalAnchor(row) {
    const canonicalType = canonicalAlignmentAnchorType(
        row.feature_type,
        row.feature_identification,
    );
    return {
        id: String(row.id),
        feature_id: row.feature_id || String(row.id),
        dist: Number(row.log_distance_m),
        log_distance_m: Number(row.log_distance_m),
        type: canonicalType || row.feature_type || row.feature_identification || 'other',
        originalType: row.feature_type || row.feature_identification || 'other',
        feature_type: row.feature_type || null,
        feature_identification: row.feature_identification || null,
        dist_to_us_gw_m: row.dist_to_us_gw_m === null ? null : Number(row.dist_to_us_gw_m),
        joint_length_m: row.joint_length_m === null ? null : Number(row.joint_length_m),
        clock: row.clock_position || null,
        clock_position: row.clock_position || null,
        depth: row.depth_pct === null ? null : Number(row.depth_pct),
        depth_pct: row.depth_pct === null ? null : Number(row.depth_pct),
        length: row.length_mm === null ? null : Number(row.length_mm),
        length_mm: row.length_mm === null ? null : Number(row.length_mm),
        width: row.width_mm === null ? null : Number(row.width_mm),
        width_mm: row.width_mm === null ? null : Number(row.width_mm),
    };
}

async function countOwnedRunFeatures(pool, { oldRunId, newRunId }, orgId) {
    const result = await pool.query(
        `SELECT f.run_id, COUNT(*)::integer AS feature_count
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = ANY($1::integer[])
           AND p.organization_id = $2
         GROUP BY f.run_id`,
        [[oldRunId, newRunId], orgId],
    );
    const counts = new Map(result.rows.map((row) => [Number(row.run_id), Number(row.feature_count)]));
    return {
        master: counts.get(newRunId) || 0,
        historical: counts.get(oldRunId) || 0,
    };
}

async function loadOwnedRunAnchors(pool, runId, orgId, { maxAnchors = MAX_DTW_ANCHORS } = {}) {
    const result = await pool.query(
        `SELECT f.id, f.feature_id, f.log_distance_m, f.feature_type,
                f.feature_identification, f.dist_to_us_gw_m, f.joint_length_m,
                f.clock_position, f.depth_pct, f.length_mm, f.width_mm
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = $1
           AND p.organization_id = $2
           AND (
               f.feature_type IN (${ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL})
               OR (
                   COALESCE(f.feature_type, '') IN ('', 'Other')
                   AND COALESCE(f.feature_identification, '') ~* '(weld|girth|seam|valve|tee|offtake|branch|bend|elbow|launcher|receiver)'
               )
           )
         ORDER BY f.log_distance_m ASC, f.id ASC
         LIMIT $3`,
        [runId, orgId, maxAnchors + 1],
    );
    if (result.rows.length > maxAnchors) {
        const error = new Error(`Inspection run has more than ${maxAnchors.toLocaleString()} alignment anchors. Narrow the run or raise MAX_DTW_RECORDS for this deployment.`);
        error.code = 'DTW_INPUT_TOO_LARGE';
        throw error;
    }
    return result.rows.map(toCanonicalAnchor);
}

async function listOwnedAlignmentResults(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT r.*
         FROM alignment_results r
         JOIN alignment_sessions s ON s.id = r.session_id
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE r.session_id = $1
           AND COALESCE(s.organization_id, p.organization_id) = $2
         ORDER BY r.id`,
        [sessionId, orgId],
    );
    return result.rows;
}

module.exports = {
    MAX_DTW_ANCHORS,
    countOwnedRunFeatures,
    listOwnedAlignmentResults,
    loadOwnedRunAnchors,
    toCanonicalAnchor,
};
