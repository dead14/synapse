const path = require('path');

function ingestionWorkerCwd() {
    return path.resolve(__dirname, '..', '..');
}

function buildIngestionArguments({
    inputPath,
    pipelineName,
    surveyYear,
    surveyDate,
    vendor,
    organizationId,
    userId,
    sourceFile,
    objectKey,
}) {
    const args = [
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
    // Omitted rather than passed empty for a job queued before the intake
    // collected a date: the importer treats a missing flag as "date unknown",
    // and an empty string would have to be parsed to reach the same answer.
    if (surveyDate) args.push('--survey-date', String(surveyDate));
    return args;
}

module.exports = { buildIngestionArguments, ingestionWorkerCwd };
