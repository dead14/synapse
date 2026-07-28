function contractError(message) {
    const error = new Error(message);
    error.code = 'INVALID_EXPORT_PAYLOAD';
    return error;
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
    return value === null
        || value === undefined
        || ['string', 'number', 'boolean'].includes(typeof value);
}

function validateRows(rows, label, maxRows) {
    if (!Array.isArray(rows)) {
        throw contractError(`${label} must be an array`);
    }
    if (rows.length > maxRows) {
        throw contractError(`Export is limited to ${maxRows} rows per sheet`);
    }
    if (!rows.every(isRecord)) {
        throw contractError(`Each ${label} row must be an object`);
    }
    if (rows.some((row) => Object.values(row).some((field) => !isScalar(field)))) {
        throw contractError(`${label} row fields must contain scalar values`);
    }
    return rows;
}

function validatePipelineData(value) {
    if (value === undefined) return {};
    if (!isRecord(value)) throw contractError('pipelineData must be an object');
    for (const [key, fieldValue] of Object.entries(value)) {
        if (key === 'inspectionRuns') continue;
        if (!isScalar(fieldValue)) {
            throw contractError('pipelineData fields must contain scalar values');
        }
    }
    const inspectionRuns = value.inspectionRuns ?? [];
    if (!Array.isArray(inspectionRuns) || inspectionRuns.length > 20 || !inspectionRuns.every(isRecord)) {
        throw contractError('pipelineData inspectionRuns must be an array of at most 20 objects');
    }
    if (inspectionRuns.some((run) => Object.values(run).some((field) => !isScalar(field)))) {
        throw contractError('pipelineData inspection run fields must contain scalar values');
    }
    return { ...value, inspectionRuns };
}

/**
 * Additive contract: legacy callers may keep sending `{ data: Row[] }`; new
 * callers send the three workbook inputs explicitly.
 */
function normalizeAlignmentExportPayload(body, { maxRows }) {
    if (!isRecord(body)) throw contractError('Export payload must be an object');
    if (Array.isArray(body.data) && body.comparison === undefined) {
        return validateRows(body.data, 'data', maxRows);
    }
    const report = validateRows(body.report ?? [], 'report', maxRows);
    return {
        pipelineData: validatePipelineData(body.pipelineData),
        report,
        comparison: body.comparison === undefined
            ? null
            : validateRows(body.comparison, 'comparison', maxRows),
    };
}

module.exports = { normalizeAlignmentExportPayload };
