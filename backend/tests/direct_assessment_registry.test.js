const test = require('node:test');
const assert = require('node:assert/strict');
const { nextPhase, parseCpSurvey, parseProject } = require('../src/modules/directAssessment/directAssessmentContract');
test('direct assessment contract enforces method, ordered phases, and CP evidence', () => {
    assert.equal(parseProject({ title: 'Line A ECDA', method: 'ECDA', selectionBasis: 'Not piggable' }).method, 'ECDA');
    assert.equal(nextPhase('pre-assessment', 'indirect-inspection'), 'indirect-inspection');
    assert.throws(() => nextPhase('pre-assessment', 'direct-examination'), /next phase/i);
    assert.equal(parseCpSurvey({ surveyType: 'CIPS', surveyDate: '2026-01-02', sourceReference: 'survey.csv', readingCount: 20 }).readingCount, 20);
});
