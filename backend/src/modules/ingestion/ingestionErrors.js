function queueUnavailableError(cause) {
    const error = new Error('Ingestion queue is unavailable');
    error.code = 'INGESTION_QUEUE_UNAVAILABLE';
    error.cause = cause;
    return error;
}

function toIngestionUploadErrorResponse(error) {
    if (error?.code === 'PARSER_DICTIONARY_UNAVAILABLE') {
        return {
            status: 503,
            body: { error: error.message, code: error.code },
        };
    }

    if (error?.code === 'ORGANIZATION_LIMIT_REACHED') {
        return {
            status: 409,
            body: { error: error.message, code: error.code },
        };
    }

    if (error?.code === 'INGESTION_QUEUE_UNAVAILABLE') {
        return {
            status: 503,
            body: { error: error.message, code: error.code },
        };
    }

    return {
        status: 500,
        body: {
            error: 'Failed to prepare ILI ingestion',
            code: 'INGESTION_PREPARATION_FAILED',
        },
    };
}

module.exports = {
    queueUnavailableError,
    toIngestionUploadErrorResponse,
};
