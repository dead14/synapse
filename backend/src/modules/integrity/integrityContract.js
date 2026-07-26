const STAGES = Object.freeze(['import', 'validate', 'align', 'assess', 'decide', 'repair', 'verify']);
const RESPONSE_CATEGORIES = Object.freeze(['immediate', 'scheduled', 'monitor', 'engineering_review']);

function requiredText(value, field, maximum = 500) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
    const normalized = value.trim();
    if (normalized.length > maximum) throw new Error(`${field} exceeds ${maximum} characters`);
    return normalized;
}

function optionalConfidence(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
        throw new Error('dataQualityConfidence must be between 0 and 1');
    }
    return number;
}

function parseCreateIntegrityCase(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be an object');
    const responseCategory = body.responseCategory == null ? null : String(body.responseCategory);
    if (responseCategory !== null && !RESPONSE_CATEGORIES.includes(responseCategory)) {
        throw new Error('responseCategory is invalid');
    }
    return {
        pipelineId: body.pipelineId == null ? null : Number(body.pipelineId),
        anomalyKey: requiredText(body.anomalyKey, 'anomalyKey', 200),
        title: requiredText(body.title, 'title', 300),
        responseCategory,
        dataQualityConfidence: optionalConfidence(body.dataQualityConfidence),
        dueAt: body.dueAt == null ? null : new Date(body.dueAt),
        methodMetadata: body.methodMetadata && typeof body.methodMetadata === 'object' && !Array.isArray(body.methodMetadata)
            ? body.methodMetadata : {},
    };
}

function parseAdvanceStage(currentStage, requestedStage) {
    if (!STAGES.includes(currentStage)) throw new Error('current stage is invalid');
    const nextStage = String(requestedStage || '');
    const expected = STAGES[STAGES.indexOf(currentStage) + 1];
    if (nextStage !== expected) throw new Error(`next stage must be ${expected || 'none'}`);
    return nextStage;
}

function parseApproval(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be an object');
    const decision = String(body.decision || '');
    if (!['approved', 'rejected'].includes(decision)) throw new Error('decision must be approved or rejected');
    return { decision, reason: requiredText(body.reason, 'reason', 2000) };
}

function parseRepairPlan(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be an object');
    return {
        repairMethod: requiredText(body.repairMethod, 'repairMethod', 300),
        engineeringBasis: requiredText(body.engineeringBasis, 'engineeringBasis', 5000),
        workOrderReference: body.workOrderReference == null ? null : requiredText(body.workOrderReference, 'workOrderReference', 200),
        digSheet: body.digSheet && typeof body.digSheet === 'object' && !Array.isArray(body.digSheet) ? body.digSheet : {},
    };
}

const EVIDENCE_STATUSES = Object.freeze(['required', 'requested', 'submitted', 'reviewed', 'accepted', 'rejected', 'superseded']);
const EVIDENCE_TRANSITIONS = Object.freeze({
    required: ['requested', 'superseded'],
    requested: ['submitted', 'superseded'],
    submitted: ['reviewed', 'rejected', 'superseded'],
    reviewed: ['accepted', 'rejected', 'superseded'],
    accepted: ['superseded'],
    rejected: ['requested', 'superseded'],
    superseded: [],
});

function parseEvidence(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be an object');
    return {
        evidenceType: requiredText(body.evidenceType, 'evidenceType', 64),
        sourceReference: body.sourceReference == null ? null : requiredText(body.sourceReference, 'sourceReference', 1000),
        repairPlanId: body.repairPlanId == null ? null : Number(body.repairPlanId),
        metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
    };
}

function parseEvidenceTransition(currentStatus, requestedStatus) {
    if (!EVIDENCE_STATUSES.includes(currentStatus)) throw new Error('current evidence status is invalid');
    const nextStatus = String(requestedStatus || '');
    if (!EVIDENCE_STATUSES.includes(nextStatus) || !EVIDENCE_TRANSITIONS[currentStatus].includes(nextStatus)) {
        throw new Error(`invalid evidence transition ${currentStatus} -> ${nextStatus}`);
    }
    return nextStatus;
}

module.exports = {
    EVIDENCE_STATUSES,
    STAGES,
    parseAdvanceStage,
    parseApproval,
    parseCreateIntegrityCase,
    parseEvidence,
    parseEvidenceTransition,
    parseRepairPlan,
};
