const crypto = require('node:crypto');
const { getJwtSecret } = require('../../config/auth');

const EVIDENCE_VERSION = 'tiein-evidence-v1';

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
        );
    }
    return value;
}

function evidencePayload({
    decision,
    transform,
    organizationId,
    runContext,
    excludedRanges,
    methodVersion,
}) {
    return JSON.stringify(stableValue({
        version: EVIDENCE_VERSION,
        organizationId: Number(organizationId),
        decision,
        transform,
        runContext,
        excludedRanges: excludedRanges || [],
        methodVersion,
    }));
}

function digestRun(run) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(stableValue(Array.isArray(run) ? run : [])))
        .digest('base64url');
}

function buildTieInEvidence(payload, organizationId, methodVersion = payload?.tieInMethodVersion) {
    const oldRunId = Number(payload?.oldRunId ?? payload?.summaryData?.oldRun?.runId);
    const newRunId = Number(payload?.newRunId ?? payload?.summaryData?.newRun?.runId);
    const hasPersistedPair = Number.isSafeInteger(oldRunId) && oldRunId > 0
        && Number.isSafeInteger(newRunId) && newRunId > 0;
    const oldRun = payload?.oldRun ?? payload?.summaryData?.oldRun?.rawFeatures;
    const newRun = payload?.newRun ?? payload?.summaryData?.newRun?.rawFeatures;
    return {
        organizationId,
        decision: payload?.tieInDecision ?? payload?.decision,
        transform: payload?.tieInTransform ?? payload?.transform,
        methodVersion,
        excludedRanges: payload?.excludedRanges ?? payload?.tieInExcludedRanges ?? [],
        runContext: hasPersistedPair
            ? { oldRunId, newRunId }
            : { oldRunDigest: digestRun(oldRun), newRunDigest: digestRun(newRun) },
    };
}

function signTieInEvidence(evidence, secret = getJwtSecret()) {
    return crypto
        .createHmac('sha256', secret)
        .update(evidencePayload(evidence))
        .digest('base64url');
}

function verifyTieInEvidence(evidence, token, secret = getJwtSecret()) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const expected = signTieInEvidence(evidence, secret);
    const suppliedBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expected);
    return suppliedBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

module.exports = { buildTieInEvidence, signTieInEvidence, verifyTieInEvidence };
