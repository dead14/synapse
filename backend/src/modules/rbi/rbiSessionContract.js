/**
 * What the browser may save as an API 580 assessment.
 *
 * The authored document (`record`) belongs to the wizard, not to this contract:
 * its shape is API 580's, it changes as the practice's sections are covered more
 * fully, and field-checking it here would mean two definitions of the same
 * document drifting apart. It is instead sanitised and bounded by the same walk
 * a published snapshot goes through, which is what actually protects the row.
 *
 * What *is* checked here is everything the registry renders without opening the
 * document — label, status, the summary counts — because those are displayed,
 * and an unbounded value in one of them is a display bug wearing a data bug's
 * clothes.
 */

const { MAX_SNAPSHOT_BYTES, sanitizeState } = require('../publicShares/publicShareContract');

/** Draft while it is being authored; issued once §16.5 sign-off is recorded. */
const STATUSES = new Set(['draft', 'issued']);

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value, field, maximum) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${field} is required`);
    }
    const text = value.trim();
    if (text.length > maximum) throw new Error(`${field} must be ${maximum} characters or fewer`);
    return text;
}

function optionalText(value, field, maximum) {
    if (value === undefined || value === null || value === '') return null;
    return requiredText(value, field, maximum);
}

/** A positive integer id, or null. Ids arrive as strings from the browser. */
function optionalId(value, field) {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${field} must be a positive integer`);
    return id;
}

function parseStatus(value) {
    if (value === undefined || value === null || value === '') return 'draft';
    if (typeof value !== 'string' || !STATUSES.has(value)) {
        throw new Error(`status must be one of ${[...STATUSES].join(', ')}`);
    }
    return value;
}

/**
 * Registry-facing counts: unit totals, the worst risk level, the earliest due
 * date. Only finite numbers, booleans, and short strings survive.
 */
function parseSummary(value) {
    if (value === undefined || value === null) return {};
    if (!isRecord(value)) throw new Error('summary must be an object');
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
        if (typeof key !== 'string' || key.length > 60) continue;
        if (typeof item === 'number' && Number.isFinite(item)) output[key] = item;
        else if (typeof item === 'boolean') output[key] = item;
        else if (typeof item === 'string') output[key] = item.slice(0, 120);
    }
    return output;
}

function parseRecord(value) {
    if (!isRecord(value)) throw new Error('record must be an object');
    const record = sanitizeState(value);
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
        throw new Error(`record exceeds ${MAX_SNAPSHOT_BYTES} bytes`);
    }
    return record;
}

function parseCreateRbiSession(body) {
    if (!isRecord(body)) throw new Error('request body must be an object');
    return {
        label: requiredText(body.label, 'label', 200),
        status: parseStatus(body.status),
        currentStep: optionalText(body.currentStep, 'currentStep', 40),
        ffsSessionId: optionalId(body.ffsSessionId, 'ffsSessionId'),
        pipelineId: optionalId(body.pipelineId, 'pipelineId'),
        summary: parseSummary(body.summary),
        record: parseRecord(body.record),
    };
}

/**
 * Re-saving an assessment that already has a session.
 *
 * The document is replaced wholesale, because a half-updated API 580 record is
 * not an API 580 record — §16.2 asks for one that can be recreated, and a
 * document merged from two authoring sessions cannot be. What the session
 * belongs to — its organization, its FFS evidence, its pipeline — is fixed at
 * creation and an update cannot move it.
 */
function parseUpdateRbiSession(body) {
    if (!isRecord(body)) throw new Error('request body must be an object');
    return {
        label: requiredText(body.label, 'label', 200),
        status: parseStatus(body.status),
        currentStep: optionalText(body.currentStep, 'currentStep', 40),
        summary: parseSummary(body.summary),
        record: parseRecord(body.record),
    };
}

module.exports = { parseCreateRbiSession, parseUpdateRbiSession };
