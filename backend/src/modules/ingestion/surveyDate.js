// The calendar date an inspection run was flown.
//
// Two shapes have to agree: what the intake form posts (an ISO `YYYY-MM-DD`
// string) and what `pg` hands back for a DATE column (a JS Date pinned to local
// midnight). Formatting that Date with `toISOString()` shifts it a day backwards
// for anyone east of UTC, which is most of the people using this, so the
// conversion reads the local calendar fields instead.

/** True for a real `YYYY-MM-DD` — including the day actually existing. */
function isIsoCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1) return false;
    // Month is 0-based here, so day 0 of the next month is the last day of this
    // one — which is how 2025-02-30 gets rejected rather than rolled forward.
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A DATE column (or an ISO string) as `YYYY-MM-DD`, or null when unset. */
function isoCalendarDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) return null;
        const year = String(value.getFullYear()).padStart(4, '0');
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const text = String(value).slice(0, 10);
    return isIsoCalendarDate(text) ? text : null;
}

/**
 * An intake-supplied survey date, validated.
 *
 * Returns `{ date, year }` so callers never have to derive the year separately
 * and let the two disagree. A blank value is accepted as "not supplied"; a
 * malformed or out-of-range one is an error, because silently dropping it would
 * store the run as though it predated the date field entirely.
 */
function parseSurveyDateInput(value) {
    const text = String(value ?? '').trim();
    if (!text) return { date: null, year: null };
    if (!isIsoCalendarDate(text)) {
        const error = new Error('Survey date must be a calendar date in YYYY-MM-DD form');
        error.code = 'INVALID_SURVEY_DATE';
        throw error;
    }
    const year = Number(text.slice(0, 4));
    if (year < 1900 || year > 2100) {
        const error = new Error('Survey date year must be between 1900 and 2100');
        error.code = 'INVALID_SURVEY_DATE';
        throw error;
    }
    return { date: text, year };
}

module.exports = { isIsoCalendarDate, isoCalendarDate, parseSurveyDateInput };
