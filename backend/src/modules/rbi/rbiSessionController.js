const pool = require('../../config/db');
const { parseCreateRbiSession, parseUpdateRbiSession } = require('./rbiSessionContract');
const {
    deleteOwnedRbiSession,
    ffsSessionBelongsToOrg,
    getOwnedRbiSession,
    insertRbiSession,
    listRbiSessions,
    updateOwnedRbiSession,
} = require('./rbiSessionRepository');

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 30;

function parsePositiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

exports.createSession = async (req, res) => {
    let payload;
    try {
        payload = parseCreateRbiSession(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_RBI_SESSION' });
    }

    try {
        let pipelineId = payload.pipelineId;
        if (payload.ffsSessionId !== null) {
            // An assessment may only cite evidence this organization owns.
            // Without this check a risk ranking could be pinned to another
            // tenant's fitness-for-service assessment.
            const ffs = await ffsSessionBelongsToOrg(pool, payload.ffsSessionId, req.user.orgId);
            if (!ffs) return res.status(404).json({ error: 'FFS session not found' });
            if (pipelineId === null) pipelineId = ffs.pipeline_id ?? null;
        }

        const created = await insertRbiSession(pool, {
            orgId: req.user.orgId,
            userId: req.user.id,
            ffsSessionId: payload.ffsSessionId,
            pipelineId,
            label: payload.label,
            status: payload.status,
            currentStep: payload.currentStep,
            summary: payload.summary,
            record: payload.record,
        });

        return res.status(201).json({
            id: String(created.id),
            createdAt: created.created_at,
            updatedAt: created.updated_at,
        });
    } catch (error) {
        console.error('Create RBI session error:', error);
        return res.status(500).json({ error: 'Failed to save the RBI assessment' });
    }
};

/**
 * Save the authored document. An RBI assessment is written across ten steps and
 * revisited over weeks, so this is the ordinary path, not an edge case.
 */
exports.updateSession = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid RBI session ID' });

    let payload;
    try {
        payload = parseUpdateRbiSession(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_RBI_SESSION' });
    }

    try {
        const updated = await updateOwnedRbiSession(
            pool, sessionId, req.user.orgId, req.user.id, payload,
        );
        if (!updated) return res.status(404).json({ error: 'RBI session not found' });
        return res.json({
            id: String(updated.id),
            createdAt: updated.created_at,
            updatedAt: updated.updated_at,
        });
    } catch (error) {
        console.error('Update RBI session error:', error);
        return res.status(500).json({ error: 'Failed to save the RBI assessment' });
    }
};

exports.listSessions = async (req, res) => {
    const requested = Number(req.query.limit);
    const limit = Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
    try {
        return res.json({ items: await listRbiSessions(pool, req.user.orgId, { limit }) });
    } catch (error) {
        console.error('List RBI sessions error:', error);
        return res.status(500).json({ error: 'Failed to load RBI assessments' });
    }
};

exports.getSession = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid RBI session ID' });
    try {
        const session = await getOwnedRbiSession(pool, sessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'RBI session not found' });
        return res.json(session);
    } catch (error) {
        console.error('Get RBI session error:', error);
        return res.status(500).json({ error: 'Failed to load the RBI assessment' });
    }
};

exports.deleteSession = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid RBI session ID' });
    try {
        const deleted = await deleteOwnedRbiSession(pool, sessionId, req.user.orgId);
        if (!deleted) return res.status(404).json({ error: 'RBI session not found' });
        return res.status(204).end();
    } catch (error) {
        console.error('Delete RBI session error:', error);
        return res.status(500).json({ error: 'Failed to delete the RBI assessment' });
    }
};
