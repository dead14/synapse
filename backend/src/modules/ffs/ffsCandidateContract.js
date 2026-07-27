/**
 * Request parsing for the Corrosion Analysis → FFS handoff.
 *
 * The client sends the complete review for one alignment session, so a save is
 * a replace rather than a patch: whatever is absent from `items` is no longer
 * an FFS candidate.
 */

const MAX_ITEMS = 20_000;
const MAX_KEY_LENGTH = 200;
const MAX_REASON_LENGTH = 500;

function requiredText(value, field, maximum) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
    const normalized = value.trim();
    if (normalized.length > maximum) throw new Error(`${field} exceeds ${maximum} characters`);
    return normalized;
}

function optionalText(value, field, maximum) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new Error(`${field} must be text`);
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maximum) throw new Error(`${field} exceeds ${maximum} characters`);
    return normalized;
}

function parseFfsCandidateSelection(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('request body must be an object');
    }

    const signature = requiredText(body.signature, 'signature', 128);
    if (!Array.isArray(body.items)) throw new Error('items must be an array');
    if (body.items.length > MAX_ITEMS) throw new Error(`items exceeds ${MAX_ITEMS} entries`);

    const seen = new Set();
    const items = body.items.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`items[${index}] must be an object`);
        }
        const sourceKey = requiredText(item.sourceKey, `items[${index}].sourceKey`, MAX_KEY_LENGTH);
        if (seen.has(sourceKey)) throw new Error(`items[${index}].sourceKey is duplicated`);
        seen.add(sourceKey);
        if (typeof item.selected !== 'boolean') throw new Error(`items[${index}].selected must be a boolean`);
        return {
            sourceKey,
            featureId: optionalText(item.featureId, `items[${index}].featureId`, MAX_KEY_LENGTH),
            selected: item.selected,
            reason: optionalText(item.reason, `items[${index}].reason`, MAX_REASON_LENGTH),
        };
    });

    return { signature, items };
}

module.exports = {
    MAX_ITEMS,
    MAX_KEY_LENGTH,
    MAX_REASON_LENGTH,
    parseFfsCandidateSelection,
};
