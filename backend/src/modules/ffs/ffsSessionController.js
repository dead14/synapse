const pool = require('../../config/db');
const { parseCreateFfsSession } = require('./ffsSessionContract');
const {
    alignmentSessionBelongsToOrg,
    deleteOwnedFfsSession,
    getOwnedFfsSession,
    insertFfsSession,
    listFfsSessions,
} = require('./ffsSessionRepository');

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 30;

function parsePositiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

exports.createSession = async (req, res) => {
    let payload;
    try {
        payload = parseCreateFfsSession(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_FFS_SESSION' });
    }

    try {
        let pipelineId = payload.pipelineId;
        if (payload.alignmentSessionId !== null) {
            // An assessment may only be filed against an alignment session this
            // organization owns, otherwise the registry would link one tenant's
            // survey run to another tenant's assessment.
            const session = await alignmentSessionBelongsToOrg(
                pool, payload.alignmentSessionId, req.user.orgId,
            );
            if (!session) {
                return res.status(404).json({ error: 'Alignment session not found' });
            }
            if (pipelineId === null) pipelineId = session.pipeline_id ?? null;
        }

        const created = await insertFfsSession(pool, {
            orgId: req.user.orgId,
            userId: req.user.id,
            alignmentSessionId: payload.alignmentSessionId,
            pipelineId,
            label: payload.label,
            method: payload.method,
            featureCount: payload.featureCount,
            summary: payload.summary,
            state: payload.state,
        });

        return res.status(201).json({
            id: String(created.id),
            createdAt: created.created_at,
        });
    } catch (error) {
        console.error('Create FFS session error:', error);
        return res.status(500).json({ error: 'Failed to save the FFS session' });
    }
};

exports.listSessions = async (req, res) => {
    const requested = Number(req.query.limit);
    const limit = Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
    try {
        return res.json({ items: await listFfsSessions(pool, req.user.orgId, { limit }) });
    } catch (error) {
        console.error('List FFS sessions error:', error);
        return res.status(500).json({ error: 'Failed to load FFS sessions' });
    }
};

exports.getSession = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid FFS session ID' });
    try {
        const session = await getOwnedFfsSession(pool, sessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'FFS session not found' });
        return res.json(session);
    } catch (error) {
        console.error('Get FFS session error:', error);
        return res.status(500).json({ error: 'Failed to load the FFS session' });
    }
};

exports.deleteSession = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid FFS session ID' });
    try {
        const deleted = await deleteOwnedFfsSession(pool, sessionId, req.user.orgId);
        if (!deleted) return res.status(404).json({ error: 'FFS session not found' });
        return res.status(204).end();
    } catch (error) {
        console.error('Delete FFS session error:', error);
        return res.status(500).json({ error: 'Failed to delete the FFS session' });
    }
};
