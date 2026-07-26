async function listOwnedIntegrityCases(pool, orgId, limit = 100) {
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
    const result = await pool.query(
        `SELECT id, pipeline_id, anomaly_key, title, stage, response_category,
                data_quality_confidence, owner_id, due_at, method_metadata,
                created_at, updated_at
         FROM integrity_cases
         WHERE organization_id = $1
         ORDER BY id DESC
         LIMIT $2`,
        [orgId, boundedLimit],
    );
    return result.rows;
}

async function createOwnedIntegrityCase(pool, orgId, userId, input) {
    const result = await pool.query(
        `INSERT INTO integrity_cases
            (organization_id, pipeline_id, anomaly_key, title, response_category,
             data_quality_confidence, due_at, method_metadata, owner_id, created_by)
         SELECT $1, p.id, $3, $4, $5, $6, $7, $8, $9, $9
         FROM (SELECT $2::integer AS requested_pipeline_id) requested
         LEFT JOIN pipelines p
           ON p.id = requested.requested_pipeline_id
          AND p.organization_id = $1
         WHERE requested.requested_pipeline_id IS NULL OR p.id IS NOT NULL
         RETURNING *`,
        [orgId, input.pipelineId, input.anomalyKey, input.title, input.responseCategory,
            input.dataQualityConfidence, input.dueAt, input.methodMetadata, userId],
    );
    return result.rows[0] || null;
}

async function getOwnedIntegrityCase(pool, caseId, orgId) {
    const result = await pool.query(
        `SELECT * FROM integrity_cases WHERE id = $1 AND organization_id = $2`,
        [caseId, orgId],
    );
    return result.rows[0] || null;
}

async function getOwnedIntegrityCaseBundle(pool, caseId, orgId) {
    const integrityCase = await getOwnedIntegrityCase(pool, caseId, orgId);
    if (!integrityCase) return null;
    const [approvals, repairPlans, evidence] = await Promise.all([
        pool.query(`SELECT * FROM integrity_approvals WHERE integrity_case_id = $1 ORDER BY id DESC LIMIT 200`, [caseId]),
        pool.query(`SELECT * FROM repair_plans WHERE integrity_case_id = $1 ORDER BY id DESC LIMIT 200`, [caseId]),
        pool.query(`SELECT * FROM integrity_evidence WHERE integrity_case_id = $1 ORDER BY id DESC LIMIT 500`, [caseId]),
    ]);
    return { case: integrityCase, approvals: approvals.rows, repairPlans: repairPlans.rows, evidence: evidence.rows };
}

async function advanceOwnedIntegrityCase(pool, caseId, orgId, nextStage) {
    const result = await pool.query(
        `UPDATE integrity_cases c
         SET stage = $3, updated_at = NOW()
         WHERE c.id = $1 AND c.organization_id = $2
           AND (
             $3::text <> 'repair'
             OR EXISTS (
               SELECT 1 FROM integrity_approvals a
               WHERE a.integrity_case_id = c.id
               ORDER BY a.id DESC
               LIMIT 1
             )
           )
           AND (
             $3::text <> 'repair'
             OR (
               SELECT a.decision FROM integrity_approvals a
               WHERE a.integrity_case_id = c.id
               ORDER BY a.id DESC LIMIT 1
             ) = 'approved'
           )
         RETURNING *`,
        [caseId, orgId, nextStage],
    );
    return result.rows[0] || null;
}

async function createOwnedApproval(pool, caseId, orgId, userId, input) {
    const result = await pool.query(
        `INSERT INTO integrity_approvals (integrity_case_id, decision, reason, actor_id)
         SELECT c.id, $3, $4, $5
         FROM integrity_cases c
         WHERE c.id = $1 AND c.organization_id = $2 AND c.stage = 'decide'
           AND c.owner_id IS DISTINCT FROM $5
         RETURNING *`,
        [caseId, orgId, input.decision, input.reason, userId],
    );
    return result.rows[0] || null;
}

async function createOwnedRepairPlan(pool, caseId, orgId, userId, input) {
    const result = await pool.query(
        `INSERT INTO repair_plans
            (integrity_case_id, repair_method, engineering_basis, dig_sheet,
             work_order_reference, created_by)
         SELECT c.id, $3, $4, $5, $6, $7
         FROM integrity_cases c
         WHERE c.id = $1 AND c.organization_id = $2 AND c.stage IN ('repair','verify')
         RETURNING *`,
        [caseId, orgId, input.repairMethod, input.engineeringBasis, input.digSheet,
            input.workOrderReference, userId],
    );
    return result.rows[0] || null;
}

async function createOwnedEvidence(pool, caseId, orgId, userId, input) {
    const result = await pool.query(
        `INSERT INTO integrity_evidence
            (integrity_case_id, repair_plan_id, evidence_type, source_reference, metadata, submitted_by)
         SELECT c.id, rp.id, $4, $5, $6, $7
         FROM integrity_cases c
         LEFT JOIN repair_plans rp
           ON rp.id = $3 AND rp.integrity_case_id = c.id
         WHERE c.id = $1 AND c.organization_id = $2
           AND ($3::bigint IS NULL OR rp.id IS NOT NULL)
         RETURNING *`,
        [caseId, orgId, input.repairPlanId, input.evidenceType, input.sourceReference,
            input.metadata, userId],
    );
    return result.rows[0] || null;
}

async function getOwnedEvidence(pool, evidenceId, orgId) {
    const result = await pool.query(
        `SELECT e.* FROM integrity_evidence e
         JOIN integrity_cases c ON c.id = e.integrity_case_id
         WHERE e.id = $1 AND c.organization_id = $2`,
        [evidenceId, orgId],
    );
    return result.rows[0] || null;
}

async function transitionOwnedEvidence(pool, evidenceId, orgId, userId, nextStatus) {
    const reviewer = ['reviewed', 'accepted', 'rejected'].includes(nextStatus) ? userId : null;
    const result = await pool.query(
        `UPDATE integrity_evidence e
         SET status = $3,
             reviewed_by = COALESCE($4, reviewed_by),
             reviewed_at = CASE WHEN $4::integer IS NULL THEN reviewed_at ELSE NOW() END
         FROM integrity_cases c
         WHERE e.integrity_case_id = c.id AND e.id = $1 AND c.organization_id = $2
         RETURNING e.*`,
        [evidenceId, orgId, nextStatus, reviewer],
    );
    return result.rows[0] || null;
}

module.exports = {
    advanceOwnedIntegrityCase,
    createOwnedApproval,
    createOwnedEvidence,
    createOwnedIntegrityCase,
    createOwnedRepairPlan,
    getOwnedEvidence,
    getOwnedIntegrityCase,
    getOwnedIntegrityCaseBundle,
    listOwnedIntegrityCases,
    transitionOwnedEvidence,
};
