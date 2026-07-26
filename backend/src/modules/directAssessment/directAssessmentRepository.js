async function listProjects(pool, orgId) {
    return (await pool.query(`SELECT * FROM direct_assessment_projects WHERE organization_id=$1 ORDER BY id DESC LIMIT 200`, [orgId])).rows;
}
async function createProject(pool, orgId, userId, input) {
    const result = await pool.query(
        `INSERT INTO direct_assessment_projects (organization_id,pipeline_id,title,method,selection_basis,created_by)
         SELECT $1,p.id,$3,$4,$5,$6 FROM (SELECT $2::integer requested_id) x
         LEFT JOIN pipelines p ON p.id=x.requested_id AND p.organization_id=$1
         WHERE x.requested_id IS NULL OR p.id IS NOT NULL RETURNING *`,
        [orgId, input.pipelineId, input.title, input.method, input.selectionBasis, userId],
    );
    return result.rows[0] || null;
}
async function getProject(pool, id, orgId) {
    return (await pool.query(`SELECT * FROM direct_assessment_projects WHERE id=$1 AND organization_id=$2`, [id, orgId])).rows[0] || null;
}
async function advanceProject(pool, id, orgId, phase) {
    return (await pool.query(`UPDATE direct_assessment_projects SET phase=$3,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING *`, [id, orgId, phase])).rows[0] || null;
}
async function addCpSurvey(pool, id, orgId, userId, input) {
    const result = await pool.query(
        `INSERT INTO cp_surveys (direct_assessment_id,survey_type,survey_date,source_reference,reading_count,metadata,created_by)
         SELECT p.id,$3,$4,$5,$6,$7,$8 FROM direct_assessment_projects p
         WHERE p.id=$1 AND p.organization_id=$2 RETURNING *`,
        [id, orgId, input.surveyType, input.surveyDate, input.sourceReference, input.readingCount, input.metadata, userId],
    );
    return result.rows[0] || null;
}
module.exports = { addCpSurvey, advanceProject, createProject, getProject, listProjects };
