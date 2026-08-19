const pool = require('../../config/db');
const { parsePipelineSpecification } = require('./pipelineSpecContract');
const {
    getPipelineSpecification,
    listPipelines,
    savePipelineSpecification,
} = require('./pipelineSpecRepository');

function parsePositiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

exports.listPipelines = async (req, res) => {
    try {
        return res.json({ items: await listPipelines(pool, req.user.orgId) });
    } catch (error) {
        console.error('List pipelines error:', error);
        return res.status(500).json({ error: 'Failed to load the pipeline register' });
    }
};

exports.getSpecification = async (req, res) => {
    const pipelineId = parsePositiveId(req.params.id);
    if (!pipelineId) return res.status(400).json({ error: 'Invalid pipeline ID' });

    try {
        const dossier = await getPipelineSpecification(pool, pipelineId, req.user.orgId);
        if (!dossier) return res.status(404).json({ error: 'Pipeline not found' });
        return res.json(dossier);
    } catch (error) {
        console.error('Get pipeline specification error:', error);
        return res.status(500).json({ error: 'Failed to load the pipeline specification' });
    }
};

exports.saveSpecification = async (req, res) => {
    const pipelineId = parsePositiveId(req.params.id);
    if (!pipelineId) return res.status(400).json({ error: 'Invalid pipeline ID' });

    let specification;
    try {
        specification = parsePipelineSpecification(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_PIPELINE_SPECIFICATION' });
    }

    try {
        const saved = await savePipelineSpecification(
            pool, pipelineId, req.user.orgId, specification, req.user.id,
        );
        if (!saved) return res.status(404).json({ error: 'Pipeline not found' });
        return res.json(saved);
    } catch (error) {
        console.error('Save pipeline specification error:', error);
        return res.status(500).json({ error: 'Failed to save the pipeline specification' });
    }
};
