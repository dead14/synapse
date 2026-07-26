const FIELD_MEASUREMENT_TYPES = Object.freeze([
    'NDE', 'EXCAVATION', 'UT', 'ILI_VALIDATION',
]);

function requiredText(value, field, maximum = 1000) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
    const normalized = value.trim();
    if (normalized.length > maximum) throw new Error(`${field} exceeds ${maximum} characters`);
    return normalized;
}

function optionalNumber(value, field, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        throw new Error(`${field} must be between ${minimum} and ${maximum}`);
    }
    return number;
}

function optionalPositiveInteger(value, field) {
    if (value === undefined || value === null || value === '') return null;
    const integer = Number(value);
    if (!Number.isSafeInteger(integer) || integer <= 0) throw new Error(`${field} must be a positive integer`);
    return integer;
}

function parseCreateFieldMeasurement(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be an object');
    const measurementType = String(body.measurementType || '');
    if (!FIELD_MEASUREMENT_TYPES.includes(measurementType)) throw new Error('measurementType is invalid');
    const observedAt = new Date(body.observedAt);
    if (Number.isNaN(observedAt.getTime())) throw new Error('observedAt is invalid');

    const depthPct = optionalNumber(body.depthPct, 'depthPct', { maximum: 100 });
    const depthMm = optionalNumber(body.depthMm, 'depthMm');
    if (depthPct === null && depthMm === null) throw new Error('depthPct or depthMm is required');

    const surveyRunId = optionalPositiveInteger(body.surveyRunId, 'surveyRunId');
    const iliFeatureId = optionalPositiveInteger(body.iliFeatureId, 'iliFeatureId');
    if (iliFeatureId !== null && surveyRunId === null) throw new Error('iliFeatureId requires surveyRunId');

    const integrityCaseId = optionalPositiveInteger(body.integrityCaseId, 'integrityCaseId');
    if (integrityCaseId === null) throw new Error('integrityCaseId is required');

    return {
        integrityCaseId,
        surveyRunId,
        iliFeatureId,
        measurementType,
        observedAt,
        chainageM: optionalNumber(body.chainageM, 'chainageM'),
        depthPct,
        depthMm,
        depthUncertaintyPct: optionalNumber(body.depthUncertaintyPct, 'depthUncertaintyPct', { maximum: 100 }),
        lengthMm: optionalNumber(body.lengthMm, 'lengthMm'),
        widthMm: optionalNumber(body.widthMm, 'widthMm'),
        sourceReference: requiredText(body.sourceReference, 'sourceReference'),
        sourceRow: optionalPositiveInteger(body.sourceRow, 'sourceRow'),
        metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
    };
}

function parseFieldMeasurementListQuery(query = {}) {
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new Error('limit must be between 1 and 200');
    }
    return {
        limit,
        beforeId: optionalPositiveInteger(query.cursor, 'cursor'),
        integrityCaseId: optionalPositiveInteger(query.integrityCaseId, 'integrityCaseId'),
    };
}

module.exports = {
    FIELD_MEASUREMENT_TYPES,
    parseCreateFieldMeasurement,
    parseFieldMeasurementListQuery,
};
