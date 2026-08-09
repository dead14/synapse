/**
 * What the browser may save as an FFS session.
 *
 * The assessment case itself (`state`) belongs to the results page, not to this
 * contract, so it is not field-checked here — it is sanitised and bounded by the
 * same walk a published link goes through. The summary beside it is checked,
 * because the registry renders those numbers without opening the case.
 */

const { MAX_SNAPSHOT_BYTES, sanitizeState } = require('../publicShares/publicShareContract');

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

function nonNegativeInteger(value, field) {
    const count = Number(value ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`${field} must be a non-negative integer`);
    }
    return count;
}

/**
 * Registry-facing counts. Only finite numbers and short strings are kept: this
 * object is displayed, so an unbounded blob here would be a display bug that
 * looks like a data bug.
 */
function parseSummary(value) {
    if (value === undefined || value === null) return {};
    if (!isRecord(value)) throw new Error('summary must be an object');
    const entries = Object.entries(value).slice(0, 40);
    const output = {};
    for (const [key, item] of entries) {
        if (typeof key !== 'string' || key.length > 60) continue;
        if (typeof item === 'number' && Number.isFinite(item)) output[key] = item;
        else if (typeof item === 'boolean') output[key] = item;
        else if (typeof item === 'string') output[key] = item.slice(0, 120);
    }
    return output;
}

function parseCreateFfsSession(body) {
    if (!isRecord(body)) throw new Error('request body must be an object');
    if (!isRecord(body.state)) throw new Error('state must be an object');

    const state = sanitizeState(body.state);
    const session = {
        label: requiredText(body.label, 'label', 200),
        method: optionalText(body.method, 'method', 60),
        alignmentSessionId: optionalId(body.alignmentSessionId, 'alignmentSessionId'),
        pipelineId: optionalId(body.pipelineId, 'pipelineId'),
        featureCount: nonNegativeInteger(body.featureCount, 'featureCount'),
        summary: parseSummary(body.summary),
        state,
    };

    const serialized = JSON.stringify(session.state);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
        throw new Error(`state exceeds ${MAX_SNAPSHOT_BYTES} bytes`);
    }
    return session;
}

module.exports = { parseCreateFfsSession };
