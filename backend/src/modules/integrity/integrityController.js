const pool = require('../../config/db');
const {
    parseAdvanceStage, parseApproval, parseCreateIntegrityCase, parseEvidence,
    parseEvidenceTransition, parseRepairPlan,
} = require('./integrityContract');
const {
    advanceOwnedIntegrityCase, createOwnedApproval, createOwnedEvidence,
    createOwnedIntegrityCase, createOwnedRepairPlan, getOwnedEvidence,
    getOwnedIntegrityCase, getOwnedIntegrityCaseBundle, listOwnedIntegrityCases, transitionOwnedEvidence,
} = require('./integrityRepository');

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

exports.listCases = async (req, res) => {
    try {
        return res.json({ items: await listOwnedIntegrityCases(pool, req.user.orgId, req.query.limit) });
    } catch (error) {
        console.error('List integrity cases error:', error);
        return res.status(500).json({ error: 'Failed to list integrity cases' });
    }
};

exports.getCase = async (req, res) => {
    const caseId = positiveId(req.params.id);
    if (!caseId) return res.status(400).json({ error: 'Invalid integrity case id' });
    try {
        const bundle = await getOwnedIntegrityCaseBundle(pool, caseId, req.user.orgId);
        if (!bundle) return res.status(404).json({ error: 'Integrity case not found' });
        return res.json(bundle);
    } catch (error) {
        console.error('Get integrity case error:', error);
        return res.status(500).json({ error: 'Failed to load integrity case' });
    }
};

exports.advanceCase = async (req, res) => {
    const caseId = positiveId(req.params.id);
    if (!caseId) return res.status(400).json({ error: 'Invalid integrity case id' });
    try {
        const current = await getOwnedIntegrityCase(pool, caseId, req.user.orgId);
        if (!current) return res.status(404).json({ error: 'Integrity case not found' });
        const nextStage = parseAdvanceStage(current.stage, req.body?.stage);
        const updated = await advanceOwnedIntegrityCase(pool, caseId, req.user.orgId, nextStage);
        if (!updated && nextStage === 'repair') return res.status(409).json({ error: 'Approved decision is required before repair' });
        return res.json(updated);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_STAGE_TRANSITION' });
    }
};

exports.createApproval = async (req, res) => {
    const caseId = positiveId(req.params.id);
    if (!caseId) return res.status(400).json({ error: 'Invalid integrity case id' });
    try {
        const approval = await createOwnedApproval(pool, caseId, req.user.orgId, req.user.id, parseApproval(req.body));
        if (!approval) return res.status(409).json({ error: 'Case must be at decide stage and approved by someone other than its owner' });
        return res.status(201).json(approval);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_APPROVAL' });
    }
};

exports.createRepairPlan = async (req, res) => {
    const caseId = positiveId(req.params.id);
    if (!caseId) return res.status(400).json({ error: 'Invalid integrity case id' });
    try {
        const plan = await createOwnedRepairPlan(pool, caseId, req.user.orgId, req.user.id, parseRepairPlan(req.body));
        if (!plan) return res.status(409).json({ error: 'Case must be in repair or verify stage' });
        return res.status(201).json(plan);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_REPAIR_PLAN' });
    }
};

exports.createEvidence = async (req, res) => {
    const caseId = positiveId(req.params.id);
    if (!caseId) return res.status(400).json({ error: 'Invalid integrity case id' });
    try {
        const input = parseEvidence(req.body);
        if (input.repairPlanId !== null && (!Number.isSafeInteger(input.repairPlanId) || input.repairPlanId <= 0)) {
            throw new Error('repairPlanId must be a positive integer');
        }
        const evidence = await createOwnedEvidence(pool, caseId, req.user.orgId, req.user.id, input);
        if (!evidence) return res.status(404).json({ error: 'Case or repair plan not found' });
        return res.status(201).json(evidence);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_EVIDENCE' });
    }
};

exports.transitionEvidence = async (req, res) => {
    const evidenceId = positiveId(req.params.evidenceId);
    if (!evidenceId) return res.status(400).json({ error: 'Invalid evidence id' });
    try {
        const current = await getOwnedEvidence(pool, evidenceId, req.user.orgId);
        if (!current) return res.status(404).json({ error: 'Evidence not found' });
        const status = parseEvidenceTransition(current.status, req.body?.status);
        return res.json(await transitionOwnedEvidence(pool, evidenceId, req.user.orgId, req.user.id, status));
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_EVIDENCE_TRANSITION' });
    }
};

exports.createCase = async (req, res) => {
    let input;
    try {
        input = parseCreateIntegrityCase(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_INTEGRITY_CASE' });
    }
    if (input.pipelineId !== null && (!Number.isSafeInteger(input.pipelineId) || input.pipelineId <= 0)) {
        return res.status(400).json({ error: 'pipelineId must be a positive integer', code: 'INVALID_INTEGRITY_CASE' });
    }
    if (input.dueAt && Number.isNaN(input.dueAt.getTime())) {
        return res.status(400).json({ error: 'dueAt must be a valid date', code: 'INVALID_INTEGRITY_CASE' });
    }
    try {
        const created = await createOwnedIntegrityCase(pool, req.user.orgId, req.user.id, input);
        if (!created) return res.status(404).json({ error: 'Pipeline not found in organization' });
        return res.status(201).json(created);
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'An integrity case already exists for this anomaly' });
        console.error('Create integrity case error:', error);
        return res.status(500).json({ error: 'Failed to create integrity case' });
    }
};
