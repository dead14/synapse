const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isIsoCalendarDate,
    isoCalendarDate,
    parseSurveyDateInput,
} = require('../src/modules/ingestion/surveyDate');

test('a survey date must be a day that exists, not merely well shaped', () => {
    assert.equal(isIsoCalendarDate('2026-02-28'), true);
    assert.equal(isIsoCalendarDate('2024-02-29'), true);
    assert.equal(isIsoCalendarDate('2026-02-29'), false);
    assert.equal(isIsoCalendarDate('2026-13-01'), false);
    assert.equal(isIsoCalendarDate('2026-04-31'), false);
    assert.equal(isIsoCalendarDate('26-04-01'), false);
});

test('a DATE column is read off the local calendar, never through toISOString', () => {
    // A DATE comes back from pg as local midnight. Formatting it in UTC would
    // report the previous day for every reader east of Greenwich, which is
    // where this product is used — the run would be dated one day early.
    const localMidnight = new Date(2026, 2, 14, 0, 0, 0);
    assert.equal(isoCalendarDate(localMidnight), '2026-03-14');
    assert.equal(isoCalendarDate('2026-03-14'), '2026-03-14');
    assert.equal(isoCalendarDate('2026-03-14T00:00:00.000Z'), '2026-03-14');
    assert.equal(isoCalendarDate(null), null);
    assert.equal(isoCalendarDate(''), null);
    assert.equal(isoCalendarDate('not a date'), null);
});

test('the intake derives the survey year from the date so the two cannot disagree', () => {
    assert.deepEqual(parseSurveyDateInput('2026-03-14'), { date: '2026-03-14', year: 2026 });
    assert.deepEqual(parseSurveyDateInput('  2021-11-02 '), { date: '2021-11-02', year: 2021 });
});

test('a run uploaded without a date is unknown, not defaulted', () => {
    assert.deepEqual(parseSurveyDateInput(''), { date: null, year: null });
    assert.deepEqual(parseSurveyDateInput(undefined), { date: null, year: null });
});

test('a malformed survey date is rejected rather than silently dropped', () => {
    // Dropping it would store the run as though it predated the date field, and
    // FFS would then ask for a date the operator believes they already gave.
    assert.throws(() => parseSurveyDateInput('14/03/2026'), /calendar date/);
    assert.throws(() => parseSurveyDateInput('2026-02-30'), /calendar date/);
    assert.throws(() => parseSurveyDateInput('1780-01-01'), /between 1900 and 2100/);
});
