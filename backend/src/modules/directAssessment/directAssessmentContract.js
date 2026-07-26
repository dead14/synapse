const PHASES = Object.freeze(['pre-assessment', 'indirect-inspection', 'direct-examination', 'post-assessment', 'reassessment']);
function text(value, field, max = 5000) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
    if (value.trim().length > max) throw new Error(`${field} is too long`);
    return value.trim();
}
function parseProject(body) {
    if (!body || typeof body !== 'object') throw new Error('request body must be an object');
    const method = String(body.method || '');
    if (!['ECDA', 'ICDA', 'SCCDA', 'CDA'].includes(method)) throw new Error('method is invalid');
    return { title: text(body.title, 'title', 300), method, selectionBasis: text(body.selectionBasis, 'selectionBasis'), pipelineId: body.pipelineId == null ? null : Number(body.pipelineId) };
}
function nextPhase(current, requested) {
    const expected = PHASES[PHASES.indexOf(current) + 1];
    if (requested !== expected) throw new Error(`next phase must be ${expected || 'none'}`);
    return requested;
}
function parseCpSurvey(body) {
    const surveyType = String(body?.surveyType || '');
    if (!['CIPS', 'DCVG', 'ACVG', 'PCM', 'SOIL'].includes(surveyType)) throw new Error('surveyType is invalid');
    const surveyDate = new Date(body.surveyDate);
    if (Number.isNaN(surveyDate.getTime())) throw new Error('surveyDate is invalid');
    const readingCount = Number(body.readingCount ?? 0);
    if (!Number.isSafeInteger(readingCount) || readingCount < 0) throw new Error('readingCount must be a non-negative integer');
    return { surveyType, surveyDate, readingCount, sourceReference: text(body.sourceReference, 'sourceReference', 1000), metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {} };
}
module.exports = { PHASES, nextPhase, parseCpSurvey, parseProject };
