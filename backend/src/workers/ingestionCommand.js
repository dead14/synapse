const path = require('path');

function ingestionWorkerCwd() {
    return path.resolve(__dirname, '..', '..');
}

function buildIngestionArguments({
    inputPath,
    pipelineName,
    surveyYear,
    vendor,
    organizationId,
    userId,
    sourceFile,
    objectKey,
}) {
    return [
        'src/python_engines/db_ingest.py',
        '--file', inputPath,
        '--pipeline', pipelineName,
        '--year', String(surveyYear),
        '--vendor', vendor,
        '--organization-id', String(organizationId),
        '--user-id', String(userId),
        '--source-name', sourceFile,
        '--source-object-key', objectKey,
    ];
}

module.exports = { buildIngestionArguments, ingestionWorkerCwd };
