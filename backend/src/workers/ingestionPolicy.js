const UNRECOVERABLE_ERROR_CODES = new Set([
    'PARSER_DICTIONARY_UNAVAILABLE',
    'INVALID_ILI_FILE',
]);

function isUnrecoverableIngestionError(error) {
    return UNRECOVERABLE_ERROR_CODES.has(error?.code);
}

function ingestionLimiter(env = process.env) {
    const max = Number(env.INGESTION_RATE_MAX);
    if (!Number.isFinite(max) || max <= 0) return null;

    const configuredDuration = Number(env.INGESTION_RATE_DURATION_MS);
    const duration = Number.isFinite(configuredDuration) && configuredDuration > 0
        ? configuredDuration
        : 60_000;
    return { max, duration };
}

module.exports = { ingestionLimiter, isUnrecoverableIngestionError };
