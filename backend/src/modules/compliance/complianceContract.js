function requiredText(value, field, maximum = 5000) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
    const normalized = value.trim();
    if (normalized.length > maximum) throw new Error(`${field} exceeds ${maximum} characters`);
    return normalized;
}

function parseRequirement(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be an object');
    return {
        code: requiredText(body.code, 'code', 100),
        title: requiredText(body.title, 'title', 300),
        edition: requiredText(body.edition, 'edition', 100),
        category: requiredText(body.category, 'category', 32),
        requirementText: requiredText(body.requirementText, 'requirementText'),
        sourceReference: requiredText(body.sourceReference, 'sourceReference', 1000),
    };
}

module.exports = { parseRequirement };
