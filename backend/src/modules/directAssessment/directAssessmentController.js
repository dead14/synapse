const pool = require('../../config/db');
const { nextPhase, parseCpSurvey, parseProject } = require('./directAssessmentContract');
const repository = require('./directAssessmentRepository');
function id(value) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
exports.list = async (req, res) => res.json({ items: await repository.listProjects(pool, req.user.orgId) });
exports.create = async (req, res) => {
    try {
        const item = await repository.createProject(pool, req.user.orgId, req.user.id, parseProject(req.body));
        if (!item) return res.status(404).json({ error: 'Pipeline not found in organization' });
        return res.status(201).json(item);
    } catch (error) { return res.status(400).json({ error: error.message }); }
};
exports.advance = async (req, res) => {
    const projectId = id(req.params.id); if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    const current = await repository.getProject(pool, projectId, req.user.orgId);
    if (!current) return res.status(404).json({ error: 'Direct assessment not found' });
    try { return res.json(await repository.advanceProject(pool, projectId, req.user.orgId, nextPhase(current.phase, req.body?.phase))); }
    catch (error) { return res.status(400).json({ error: error.message }); }
};
exports.addCpSurvey = async (req, res) => {
    const projectId = id(req.params.id); if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    try {
        const survey = await repository.addCpSurvey(pool, projectId, req.user.orgId, req.user.id, parseCpSurvey(req.body));
        if (!survey) return res.status(404).json({ error: 'Direct assessment not found' });
        return res.status(201).json(survey);
    } catch (error) { return res.status(400).json({ error: error.message }); }
};
