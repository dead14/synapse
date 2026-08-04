const pool = require('../../config/db');
const {
    parseInspectionAnchorListQuery,
    parseInspectionBucketQuery,
    parseInspectionFeatureListQuery,
    parseInspectionListQuery,
    serializeInspectionAnchor,
    serializeInspectionBucket,
    serializeInspectionFeature,
    serializeInspectionProfile,
    serializeInspectionRun,
} = require('./inspectionContract');
const {
    getOwnedInspectionBuckets,
    getOwnedInspectionProfile,
    listOwnedInspectionAnchors,
    listOwnedInspectionFeatures,
    listOwnedInspectionRuns,
} = require('./inspectionRepository');

function parsePositiveId(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

exports.listInspectionRuns = async (req, res) => {
    let pagination;
    try {
        pagination = parseInspectionListQuery(req.query);
    } catch (error) {
        return res.status(400).json({
            error: error.message,
            code: 'INVALID_INSPECTION_PAGINATION',
        });
    }

    try {
        const page = await listOwnedInspectionRuns(
            pool,
            req.user.orgId,
            pagination,
        );
        return res.json({
            items: page.rows.map(serializeInspectionRun),
            nextCursor: page.nextCursor === null ? null : String(page.nextCursor),
        });
    } catch (error) {
        console.error('List inspection runs error:', error);
        return res.status(500).json({ error: 'Failed to list inspection runs' });
    }
};

exports.getInspectionProfile = async (req, res) => {
    const runId = parsePositiveId(req.params.id);
    if (!runId) {
        return res.status(400).json({
            error: 'Invalid inspection run id',
            code: 'INVALID_INSPECTION_RUN_ID',
        });
    }

    try {
        const row = await getOwnedInspectionProfile(pool, runId, req.user.orgId);
        if (!row) return res.status(404).json({ error: 'Inspection run not found' });
        return res.json(serializeInspectionProfile(row));
    } catch (error) {
        console.error('Inspection profile error:', error);
        return res.status(500).json({ error: 'Failed to load inspection profile' });
    }
};

exports.listInspectionAnchors = async (req, res) => {
    const runId = parsePositiveId(req.params.id);
    if (!runId) {
        return res.status(400).json({
            error: 'Invalid inspection run id',
            code: 'INVALID_INSPECTION_RUN_ID',
        });
    }

    let pagination;
    try {
        pagination = parseInspectionAnchorListQuery(req.query);
    } catch (error) {
        return res.status(400).json({
            error: error.message,
            code: 'INVALID_INSPECTION_ANCHOR_PAGINATION',
        });
    }

    try {
        const page = await listOwnedInspectionAnchors(
            pool,
            runId,
            req.user.orgId,
            pagination,
        );
        return res.json({
            items: page.rows.map(serializeInspectionAnchor),
            nextCursor: page.nextCursor === null
                ? null
                : Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url'),
        });
    } catch (error) {
        console.error('Inspection anchors error:', error);
        return res.status(500).json({ error: 'Failed to load inspection anchors' });
    }
};

exports.listInspectionFeatures = async (req, res) => {
    const runId = parsePositiveId(req.params.id);
    if (!runId) return res.status(400).json({ error: 'Invalid inspection run id', code: 'INVALID_INSPECTION_RUN_ID' });
    let query;
    try {
        query = parseInspectionFeatureListQuery(req.query);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_INSPECTION_FEATURE_PAGINATION' });
    }
    try {
        const page = await listOwnedInspectionFeatures(pool, runId, req.user.orgId, query);
        return res.json({
            items: page.rows.map(serializeInspectionFeature),
            nextCursor: page.nextCursor === null
                ? null
                : Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url'),
        });
    } catch (error) {
        console.error('Inspection features error:', error);
        return res.status(500).json({ error: 'Failed to load inspection features' });
    }
};

exports.listInspectionBuckets = async (req, res) => {
    const runId = parsePositiveId(req.params.id);
    if (!runId) return res.status(400).json({ error: 'Invalid inspection run id', code: 'INVALID_INSPECTION_RUN_ID' });
    let query;
    try {
        query = parseInspectionBucketQuery(req.query);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_INSPECTION_BUCKET_QUERY' });
    }
    try {
        const rows = await getOwnedInspectionBuckets(pool, runId, req.user.orgId, query);
        return res.json({ items: rows.map((row) => ({ ...serializeInspectionBucket(row), bucketM: query.bucketM })) });
    } catch (error) {
        console.error('Inspection buckets error:', error);
        return res.status(500).json({ error: 'Failed to load inspection buckets' });
    }
};

exports.deleteInspectionRun = async (req, res) => {
    const runId = parsePositiveId(req.params.id);
    if (!runId) {
        return res.status(400).json({
            error: 'Invalid inspection run id',
            code: 'INVALID_INSPECTION_RUN_ID',
        });
    }

    try {
        const { deleteOwnedInspectionRun } = require('./inspectionRepository');
        const deleted = await deleteOwnedInspectionRun(pool, runId, req.user.orgId);
        if (!deleted) return res.status(404).json({ error: 'Inspection run not found' });
        return res.status(204).send();
    } catch (error) {
        console.error('Delete inspection run error:', error);
        return res.status(500).json({ error: 'Failed to delete inspection run' });
    }
};
