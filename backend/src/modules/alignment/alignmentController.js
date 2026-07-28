const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const {
    findOwnedSession,
    findLatestOwnedSession,
    listOwnedSessions,
    createOwnedSession,
    updateOwnedSessionConfig,
    deleteOwnedSession,
    createAlignmentJob,
    getLatestAlignmentJob,
    getOwnedAlignmentJob,
    listOwnedAlignmentResultPage,
    serializeAlignmentJob,
    updateAlignmentJob,
} = require('./alignmentRepository');
const {
    countOwnedRunFeatures,
    listOwnedAlignmentResults,
    loadOwnedRunAnchors,
} = require('./anchorRepository');
const {
    validateDtwPayload,
    validateMatchingSections,
    validateAlignmentReview,
    normalizeCanonicalGwLocks,
    normalizeAlignmentReviewForPersistence,
    normalizeInterventionEvent,
    normalizePairGwResultsForPersistence,
    preserveCanonicalGwEvidence,
    sameGwReviewDecisions,
} = require('./alignmentContract');
const {
    buildRunEndpointRejection,
    getAlignmentStrategyCapability,
    listAlignmentStrategyCapabilities,
} = require('./alignmentStrategyCapabilities');
const { buildTieInEvidence, signTieInEvidence, verifyTieInEvidence } = require('./tieInEvidence');
const ingestionController = require('../ingestion/ingestionController');
const { toIngestionUploadErrorResponse } = require('../ingestion/ingestionErrors');
const { alignmentQueue } = require('./alignmentWorker');
const {
    canonicalSignature,
    canonicalSignatureForConfig,
    canonicalSignaturesEqual,
} = require('./alignmentSignature');
const {
    ALIGNMENT_ENGINE_VERSION,
    alignmentConfigFingerprint,
    buildReusableAlignmentJobResponse,
    isReusableAlignmentJob,
} = require('./alignmentExecution');
const {
    parseAlignmentResultPageQuery,
} = require('./alignmentResultPaging');
const {
    findSessionRunPair,
    primarySessionRunPair,
    runPairKey,
} = require('./runPairIdentity');
const {
    startPythonWorkers,
    stopPythonWorkers,
    getPythonWorkerStates,
    runDtwRequest,
    runTieInRequest,
} = require('./pythonWorkers');
const { createExcelExport } = require('./exportService');
const { normalizeAlignmentExportPayload } = require('./exportContract');

// The DTW/tie-in worker lifecycle lives in pythonWorkers.js; the re-exports
// keep the import path stable for consumers outside this module
// (config/health.js resolves getPythonWorkerStates through the controller).
exports.startPythonWorkers = startPythonWorkers;
exports.stopPythonWorkers = stopPythonWorkers;
exports.getPythonWorkerStates = getPythonWorkerStates;

const MAX_EXPORT_ROWS = Number(process.env.MAX_EXPORT_ROWS) || 100_000;
const CONTROLLED_ALIGNMENT_ERROR_CODES = new Set([
    'INVALID_TIEIN_TRANSFORM',
    'PARTIAL_RUN_TIEIN_REQUIRED',
    'TIEIN_LOCK_RESOLUTION_FAILED',
    'NO_ALIGNMENT_ANCHORS',
]);

function parsePositiveId(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSessionRevision(value) {
    return typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null;
}

function reviewPersistenceError(message, code = 'INVALID_ALIGNMENT_REVIEW') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function getPersistedRunReferences(config) {
    const oldRunId = parsePositiveId(config?.summaryData?.oldRun?.runId);
    const newRunId = parsePositiveId(config?.summaryData?.newRun?.runId);
    if (!oldRunId || !newRunId || oldRunId === newRunId) {
        throw reviewPersistenceError('The alignment session must reference two distinct persisted inspection runs');
    }
    return { oldRunId, newRunId };
}

/**
 * The run pair a GW matching request is asking for.
 *
 * Chain alignment gives a session N-1 pairs, and the wizard switches between
 * them, so the session's `oldRun`/`newRun` fields cannot be forced onto every
 * request — doing that silently recomputed the same pair no matter which one the
 * operator selected. The requested pair is still resolved against the session's
 * own chain rather than trusted, because run ids arriving from a client must
 * never be able to reach another organization's persisted features.
 */
function resolveRequestedRunPair(config, body) {
    const requestedOldRunId = parsePositiveId(body?.oldRunId);
    const requestedNewRunId = parsePositiveId(body?.newRunId);
    if (!requestedOldRunId || !requestedNewRunId) {
        return getPersistedRunReferences(config);
    }
    const pair = findSessionRunPair(config, {
        oldRunId: requestedOldRunId,
        newRunId: requestedNewRunId,
    });
    if (!pair) {
        throw reviewPersistenceError(
            'The requested inspection run pair does not belong to this alignment session.',
            'UNKNOWN_ALIGNMENT_RUN_PAIR',
        );
    }
    return { oldRunId: pair.oldRunId, newRunId: pair.newRunId };
}

function hasReviewEvidence(config) {
    return config?.dataReview !== undefined
        || config?.gwReview !== undefined
        || Object.values(config?.pairGwResults || {}).some((result) => result?.gwReview !== undefined);
}

/**
 * The settings a given run pair's GW matching actually ran under.
 *
 * Each pair carries its own tie-in transform and its own OTA, so signing a
 * pair's review with the session-level fields would compare it against settings
 * that belong to a different pair.
 */
function pairScopedSignatureConfig(config, pairKey) {
    const pairTieIn = config?.pairTieIns?.[pairKey];
    const pairResult = config?.pairGwResults?.[pairKey];
    return {
        ota: pairResult?.ota ?? config?.ota,
        strictPenalty: pairResult?.strictPenalty ?? config?.strictPenalty,
        useValveAnchor: pairResult?.useValveAnchor ?? config?.useValveAnchor,
        dtwOn: pairResult?.dtwOn ?? config?.dtwOn,
        globalOffset: pairTieIn?.globalOffset ?? config?.globalOffset,
        tieInTransform: pairTieIn?.tieInTransform ?? config?.tieInTransform,
        tieInDecision: pairTieIn?.tieInDecision ?? config?.tieInDecision,
        tieInEvidenceToken: pairTieIn?.tieInEvidenceToken ?? config?.tieInEvidenceToken,
        tieInMethodVersion: pairTieIn?.tieInMethodVersion ?? config?.tieInMethodVersion,
        tieInExcludedRanges: pairTieIn?.tieInExcludedRanges ?? config?.tieInExcludedRanges,
    };
}

/**
 * Repair sessions written by the short-lived client snapshot bug: they retain
 * a reviewed GW result but lost the server-side canonical evidence needed to
 * validate it on the next wizard save.  Only recover evidence that was already
 * stored on the session and whose settings signature still matches the current
 * request; changed settings must continue to require a fresh DTW run.
 */
function recoverLegacyCanonicalGwEvidence(config, persistedConfig) {
    const recovered = preserveCanonicalGwEvidence(config, persistedConfig);
    const evidence = { ...(recovered.pairGwEvidence || {}) };
    const persistedResults = persistedConfig?.pairGwResults || {};
    const primary = primarySessionRunPair(persistedConfig || {});

    // Some legacy/client snapshots removed the pair container while retaining
    // the canonical result at the session root. Restore it only for the
    // session's primary pair and only when the server signature still proves
    // that the result belongs to the current matching settings.
    if (primary && !evidence[primary.key] && persistedConfig?.gwReview) {
        const rootLocks = Array.isArray(recovered.canonicalGwLocks)
            ? recovered.canonicalGwLocks
            : persistedConfig?.gwMatchesFinal;
        const expectedSignature = canonicalSignatureForConfig(
            pairScopedSignatureConfig(config, primary.key),
            { oldRunId: primary.oldRunId, newRunId: primary.newRunId },
        );
        const canonicalSignature = persistedConfig?.gwCanonicalSignature
            ?? persistedConfig?.gwReviewSignature;
        if (
            Array.isArray(rootLocks)
            && canonicalSignaturesEqual(canonicalSignature, expectedSignature)
            && canonicalSignaturesEqual(persistedConfig?.gwReviewSignature, expectedSignature)
        ) {
            try {
                evidence[primary.key] = {
                    canonicalGwLocks: normalizeCanonicalGwLocks(rootLocks),
                    gwCanonicalSignature: expectedSignature,
                };
            } catch {
                // Invalid legacy locks must still be recalculated by the DTW engine.
            }
        }
    }

    for (const [pairKey, result] of Object.entries(persistedResults)) {
        if (evidence[pairKey] || !result?.gwReview || !Array.isArray(result.gwMatchesFinal)) continue;
        const [oldValue, newValue] = pairKey.split('->');
        const pair = findSessionRunPair(persistedConfig || {}, {
            oldRunId: Number(oldValue),
            newRunId: Number(newValue),
        });
        if (!pair) continue;
        const expectedSignature = canonicalSignatureForConfig(
            pairScopedSignatureConfig(config, pairKey),
            { oldRunId: pair.oldRunId, newRunId: pair.newRunId },
        );
        if (!canonicalSignaturesEqual(result.gwReviewSignature, expectedSignature)) continue;
        try {
            evidence[pairKey] = {
                canonicalGwLocks: normalizeCanonicalGwLocks(result.gwMatchesFinal),
                gwCanonicalSignature: expectedSignature,
            };
        } catch {
            // Invalid legacy locks must still be recalculated by the DTW engine.
        }
    }

    if (Object.keys(evidence).length > 0) recovered.pairGwEvidence = evidence;
    if (!Array.isArray(recovered.canonicalGwLocks) && primary && evidence[primary.key]) {
        recovered.canonicalGwLocks = evidence[primary.key].canonicalGwLocks;
        recovered.gwCanonicalSignature = evidence[primary.key].gwCanonicalSignature;
    }
    return recovered;
}

exports.recoverLegacyCanonicalGwEvidence = recoverLegacyCanonicalGwEvidence;

function normalizeRecoveredAlignmentReview(configToPersist, persistedConfig, { featureCounts } = {}) {
    return normalizeAlignmentReviewForPersistence(configToPersist, {
        featureCounts,
        canonicalGwLocks: persistedConfig?.canonicalGwLocks,
        existingDataReview: persistedConfig?.dataReview,
    });
}

exports.normalizeRecoveredAlignmentReview = normalizeRecoveredAlignmentReview;

function requireServerTieInEvidence(payload, organizationId) {
    if (payload?.tieInTransform === undefined || payload?.tieInTransform === null) return;
    const valid = verifyTieInEvidence(
        buildTieInEvidence(payload, organizationId),
        payload.tieInEvidenceToken,
    );
    if (!valid) {
        throw reviewPersistenceError(
            'Tie-in transform is not bound to server-estimated evidence. Recalculate Tie-In.',
            'INVALID_TIEIN_EVIDENCE',
        );
    }
}

async function hydrateRunReferences(payload, orgId) {
    const oldRunId = parsePositiveId(payload?.oldRunId);
    const newRunId = parsePositiveId(payload?.newRunId);
    const referencesProvided = payload?.oldRunId !== undefined || payload?.newRunId !== undefined;
    if (!referencesProvided) return payload;
    if (!oldRunId || !newRunId) {
        const error = new Error('oldRunId and newRunId must both be valid inspection run ids');
        error.code = 'INVALID_ALIGNMENT_PAYLOAD';
        throw error;
    }

    const [oldRun, newRun] = await Promise.all([
        loadOwnedRunAnchors(pool, oldRunId, orgId),
        loadOwnedRunAnchors(pool, newRunId, orgId),
    ]);

    // A run whose features never normalized into an anchor type returns an
    // empty set here.  Passing it through produced a successful response with
    // zero matches, which the timeline renders identically to "not run yet" —
    // so the operator saw an empty chart and no reason for it.  Name the run
    // that has no anchors instead.
    const emptyRuns = [
        ...(oldRun.length === 0 ? [`OLD run ${oldRunId}`] : []),
        ...(newRun.length === 0 ? [`NEW run ${newRunId}`] : []),
    ];
    if (emptyRuns.length > 0) {
        const error = new Error(
            `${emptyRuns.join(' and ')} contains no alignment anchors. `
            + 'Alignment needs Weld, Valve, Tee, Flange, Bend, or Offtake features with a numeric log distance. '
            + 'Check the feature-type mapping for this inspection run.',
        );
        error.code = 'NO_ALIGNMENT_ANCHORS';
        throw error;
    }

    return { ...payload, oldRun, newRun };
}

exports.uploadCsv = async (req, res) => {
    const { pipelineName, surveyYear, vendor } = req.body;
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        // Only the first 512 bytes matter for the magic-byte check; reading
        // the whole upload (up to 25 MB) synchronously blocked the event loop.
        let prefix;
        let handle;
        try {
            handle = await fsPromises.open(file.path, 'r');
            const header = Buffer.alloc(512);
            const { bytesRead } = await handle.read(header, 0, header.length, 0);
            prefix = header.subarray(0, bytesRead);
        } finally {
            await handle?.close().catch(() => {});
        }
        const extension = path.extname(file.originalname || '').toLowerCase();
        const isZipWorkbook = prefix.length >= 2 && prefix[0] === 0x50 && prefix[1] === 0x4B;
        const looksBinaryCsv = extension === '.csv' && prefix.includes(0);
        if ((extension === '.xlsx' && !isZipWorkbook) || looksBinaryCsv) {
            fs.unlink(file.path, () => {});
            return res.status(415).json({ error: 'Uploaded file content does not match its extension' });
        }
    } catch (error) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Uploaded file could not be inspected' });
    }

    const normalizedPipelineName = String(pipelineName || '').trim();
    const normalizedVendor = String(vendor || '').trim();
    const normalizedYear = Number(surveyYear);
    if (!normalizedPipelineName || normalizedPipelineName.length > 120) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Pipeline name is required and must be at most 120 characters' });
    }
    if (!normalizedVendor || normalizedVendor.length > 120) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Vendor is required and must be at most 120 characters' });
    }
    if (!Number.isInteger(normalizedYear) || normalizedYear < 1900 || normalizedYear > 2100) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Survey year is invalid' });
    }

    try {
        const intake = await ingestionController.enqueueIngestion({
            file,
            pipelineName: normalizedPipelineName,
            surveyYear: normalizedYear,
            vendor: normalizedVendor,
            user: req.user,
        });
        fs.unlink(file.path, () => {});
        if (intake.kind === 'existing') {
            const audit = intake.run.ingestion_audit && typeof intake.run.ingestion_audit === 'object'
                ? intake.run.ingestion_audit
                : {};
            const acceptedRows = Number(intake.run.row_count || 0);
            return res.status(200).json({
                message: 'Existing inspection run reused',
                pipeline_run_id: Number(intake.run.run_id),
                run_summary: audit.feature_counts || { total: acceptedRows },
                audit: { ...audit, accepted_rows: audit.accepted_rows ?? acceptedRows },
                source_sha256: intake.run.source_sha256 || null,
                reused: true,
            });
        }
        const job = intake.job;
        return res.status(202).json({
            message: 'Ingestion queued',
            jobId: job.job_id,
            state: job.state,
            progress: Number(job.progress || 0),
            sourceFile: job.source_file,
        });
    } catch (error) {
        fs.unlink(file.path, () => {});
        console.error('Failed to queue ingestion:', error);
        const response = toIngestionUploadErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
};

// The wizard used to hard-code its strategy dropdown, so an operator could pick
// an unvalidated engine, complete every remaining step, and only discover the
// rejection at execution.  Serving the capability table lets the picker close
// that dead end at the point of choice.
exports.listAlignmentStrategies = (_req, res) => {
    return res.json({ strategies: listAlignmentStrategyCapabilities() });
};

exports.runAlignment = (req, res) => {
    const rejection = buildRunEndpointRejection(req.body?.algorithm);
    return res.status(422).json(rejection);
};

exports.getAlignmentResults = async (req, res) => {
    const runId = parsePositiveId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid session ID' });
    try {
        const rows = await listOwnedAlignmentResults(pool, runId, req.user.orgId);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch alignment results' });
    }
};

exports.getAlignmentResultsPage = async (req, res) => {
    const sessionId = parsePositiveId(req.params.runId);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });
    let pageQuery;
    try {
        pageQuery = parseAlignmentResultPageQuery(req.query);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    try {
        const page = await listOwnedAlignmentResultPage(
            pool,
            sessionId,
            req.user.orgId,
            pageQuery,
        );
        return res.json({
            items: page.rows,
            nextCursor: page.nextCursor === null ? null : String(page.nextCursor),
        });
    } catch (error) {
        console.error('Paged alignment results error:', error);
        return res.status(500).json({ error: 'Failed to fetch paged alignment results' });
    }
};

exports.runDtwAlignment = async (req, res) => {
    let payload;
    let session = null;
    let persistedReferences = null;
    try {
        const sessionId = parsePositiveId(req.body?.sessionId);
        if (req.body?.sessionId !== undefined && !sessionId) {
            throw reviewPersistenceError('Invalid alignment session ID', 'INVALID_ALIGNMENT_PAYLOAD');
        }
        if (sessionId) {
            session = await findOwnedSession(pool, sessionId, req.user.orgId);
            if (!session) {
                throw reviewPersistenceError('Alignment session not found', 'ALIGNMENT_SESSION_NOT_FOUND');
            }
            persistedReferences = resolveRequestedRunPair(session.params_json || {}, req.body);
        }
        payload = await hydrateRunReferences({
            ...req.body,
            ...(persistedReferences || {}),
        }, req.user.orgId);
        requireServerTieInEvidence(payload, req.user.orgId);
        validateDtwPayload(payload);
    } catch (err) {
        const status = err.code === 'DTW_INPUT_TOO_LARGE'
            ? 413
            : err.code === 'ALIGNMENT_SESSION_NOT_FOUND'
                ? 404
                : CONTROLLED_ALIGNMENT_ERROR_CODES.has(err.code) ? 422 : 400;
        return res.status(status).json({
            error: err.message,
            code: err.code || 'INVALID_ALIGNMENT_PAYLOAD',
        });
    }
    try {
        // Log payload length for debugging
        console.log(`[DTW] Request: oldRun=${payload.oldRun?.length}, newRun=${payload.newRun?.length}`);
        const result = await runDtwRequest(payload);

        if (result.success) {
            if (session && persistedReferences) {
                const canonicalGwLocks = normalizeCanonicalGwLocks(result.gwMatchesFinal);
                const current = await findOwnedSession(pool, session.id, req.user.orgId);
                if (!current) return res.status(404).json({ error: 'Alignment session not found' });
                // The pair must still be part of this session's chain. Comparing
                // against the session's single oldRun/newRun instead would reject
                // every pair except the last one the moment chains got longer.
                if (!findSessionRunPair(current.params_json || {}, persistedReferences)) {
                    return res.status(409).json({ error: 'Inspection runs changed while GW matching was running. Refresh and try again.' });
                }
                const signature = canonicalSignature(payload, persistedReferences);
                const pairKey = runPairKey(persistedReferences.oldRunId, persistedReferences.newRunId);
                const isPrimaryPair = primarySessionRunPair(current.params_json || {})?.key === pairKey;
                const previousPairEvidence = current.params_json?.pairGwEvidence?.[pairKey];
                const config = {
                    ...(current.params_json || {}),
                    // Every pair keeps its own canonical locks. One shared field
                    // meant matching a second pair overwrote the first pair's
                    // evidence, and its saved review then failed validation.
                    pairGwEvidence: {
                        ...(current.params_json?.pairGwEvidence || {}),
                        [pairKey]: { canonicalGwLocks, gwCanonicalSignature: signature },
                    },
                };
                // Legacy single-pair consumers still read the unscoped fields.
                if (isPrimaryPair) {
                    config.canonicalGwLocks = canonicalGwLocks;
                    config.gwCanonicalSignature = signature;
                }
                if (previousPairEvidence?.gwCanonicalSignature !== signature) {
                    // Settings changed for this pair only, so only this pair's
                    // downstream review and sections become stale.
                    if (config.pairGwResults?.[pairKey]) {
                        const { [pairKey]: _stale, ...remaining } = config.pairGwResults;
                        config.pairGwResults = remaining;
                    }
                    if (Array.isArray(config.matchingSections)) {
                        config.matchingSections = config.matchingSections.filter((section) => (
                            section?.pairKey ? section.pairKey !== pairKey : !isPrimaryPair
                        ));
                    }
                    if (isPrimaryPair) {
                        delete config.gwReview;
                        delete config.gwMatchesFinal;
                    }
                }
                const updated = await updateOwnedSessionConfig(pool, session.id, req.user.orgId, config);
                if (!updated) return res.status(409).json({ error: 'GW matching result could not be saved. Refresh and try again.' });
                result.sessionRevision = updated.revision;
            }
            res.json(result);
        } else {
            console.error(`[DTW] Request ${result.requestId} failed:`, result.error);
            const status = result.code === 'DTW_INPUT_TOO_LARGE'
                ? 413
                : CONTROLLED_ALIGNMENT_ERROR_CODES.has(result.code) ? 422 : 500;
            res.status(status).json({
                error: result.error,
                code: result.code || 'ALIGNMENT_ENGINE_FAILED',
                ...(Array.isArray(result.unresolvedKnotIndexes)
                    ? { unresolvedKnotIndexes: result.unresolvedKnotIndexes }
                    : {}),
            });
        }
    } catch (err) {
        // Admission-control rejection: every worker is busy and the queue is
        // full.  Mirrors the export concurrency cap's 429 response.
        if (err.code === 'ENGINE_BUSY') {
            res.set('Retry-After', '10');
            return res.status(429).json({ error: err.message, code: 'ENGINE_BUSY' });
        }
        console.error('[DTW] Request exception:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.estimateTieInOffset = async (req, res) => {
    let payload;
    try {
        payload = await hydrateRunReferences({ ...req.body }, req.user.orgId);
        validateDtwPayload(payload);
    } catch (err) {
        return res.status(err.code === 'DTW_INPUT_TOO_LARGE' ? 413 : 400).json({
            error: err.message,
            code: err.code || 'INVALID_ALIGNMENT_PAYLOAD',
        });
    }
    try {
        const result = await runTieInRequest(payload);

        if (result.success && result.transform && result.decision) {
            result.evidenceToken = signTieInEvidence(buildTieInEvidence({
                ...payload,
                decision: result.decision,
                transform: result.transform,
            }, req.user.orgId, result.methodVersion));

            // Partial Run cannot fall back to a scalar offset, so a
            // REVIEW_REQUIRED estimate would otherwise dead-end the wizard.  The
            // server decides what an acknowledged decision looks like and signs
            // it here; the client can only replay it, never author it.
            if (result.decision.status === 'REVIEW_REQUIRED') {
                const acknowledgedDecision = {
                    ...result.decision,
                    status: 'REVIEW_ACKNOWLEDGED',
                    originalStatus: 'REVIEW_REQUIRED',
                    requiresHumanReview: true,
                    acknowledgedBy: Number(req.user.id),
                };
                result.reviewAcknowledgement = {
                    decision: acknowledgedDecision,
                    evidenceToken: signTieInEvidence(buildTieInEvidence({
                        ...payload,
                        decision: acknowledgedDecision,
                        transform: result.transform,
                    }, req.user.orgId, result.methodVersion)),
                };
            }
        }
        res.json(result);
    } catch (err) {
        if (err.code === 'ENGINE_BUSY') {
            res.set('Retry-After', '10');
            return res.status(429).json({ error: err.message, code: 'ENGINE_BUSY' });
        }
        res.status(500).json({ error: err.message });
    }
};

exports.saveWizardState = async (req, res) => {
    const { config, sessionId, sessionRevision } = req.body || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return res.status(400).json({ error: 'Config object is required' });
    }
    try {
        requireServerTieInEvidence(config, req.user.orgId);
    } catch (err) {
        return res.status(422).json({ error: err.message, code: err.code });
    }
    try {
        if (sessionId) {
            const parsedSessionId = parsePositiveId(sessionId);
            if (!parsedSessionId) return res.status(400).json({ error: 'Invalid session ID' });
            const session = await findOwnedSession(pool, parsedSessionId, req.user.orgId);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            const requiresReviewBoundary = hasReviewEvidence(config);
            const expectedRevision = parseSessionRevision(sessionRevision);
            if (requiresReviewBoundary && !expectedRevision) {
                return res.status(409).json({ error: 'This review is out of date. Refresh the alignment session before saving.' });
            }
            // The browser sends a wizard snapshot, not the server-authored GW
            // evidence recorded when DTW completed. Preserve that evidence
            // across every later step so Sectioning cannot lose its canonical
            // locks and reject the next save.
            let configToPersist = recoverLegacyCanonicalGwEvidence(config, session.params_json);
            try {
                if (requiresReviewBoundary) {
                    const references = getPersistedRunReferences(session.params_json || {});
                    const featureCounts = await countOwnedRunFeatures(pool, references, req.user.orgId);
                    // Sectioning and later steps resave the already-approved
                    // review as part of the full wizard config. Validate only a
                    // new decision, not an unchanged historical record.
                    if (config.gwReview !== undefined
                        && !sameGwReviewDecisions(config.gwReview, session.params_json?.gwReview)
                        && !canonicalSignaturesEqual(
                            configToPersist.gwCanonicalSignature,
                            canonicalSignatureForConfig(config, references),
                        )) {
                        throw reviewPersistenceError('GW matching settings changed. Recalculate the canonical matching result before saving review decisions.');
                    }
                    configToPersist = normalizeRecoveredAlignmentReview(
                        configToPersist,
                        session.params_json,
                        { featureCounts },
                    );
                    for (const [pairKey, pairResult] of Object.entries(config.pairGwResults || {})) {
                        if (pairResult?.gwReview === undefined
                            || sameGwReviewDecisions(
                                pairResult.gwReview,
                                session.params_json?.pairGwResults?.[pairKey]?.gwReview,
                            )) continue;
                        const pair = findSessionRunPair(session.params_json || {}, {
                            oldRunId: Number(pairKey.split('->')[0]),
                            newRunId: Number(pairKey.split('->')[1]),
                        });
                        if (!pair) {
                            throw reviewPersistenceError(
                                `Run pair ${pairKey} does not belong to this alignment session.`,
                                'UNKNOWN_ALIGNMENT_RUN_PAIR',
                            );
                        }
                        const expected = canonicalSignatureForConfig(
                            pairScopedSignatureConfig(config, pairKey),
                            { oldRunId: pair.oldRunId, newRunId: pair.newRunId },
                        );
                        if (!canonicalSignaturesEqual(
                            configToPersist.pairGwEvidence?.[pairKey]?.gwCanonicalSignature,
                            expected,
                        )) {
                            throw reviewPersistenceError(`GW matching settings changed for pair ${pairKey}. Recalculate that pair before saving its review decisions.`);
                        }
                    }
                    const pairGwResults = normalizePairGwResultsForPersistence(configToPersist, {
                        pairGwEvidence: configToPersist.pairGwEvidence,
                    });
                    if (pairGwResults !== undefined) configToPersist.pairGwResults = pairGwResults;
                    if (Array.isArray(configToPersist.canonicalGwLocks)) {
                        if (config.gwReview === undefined) {
                            configToPersist.gwMatchesFinal = session.params_json.gwMatchesFinal || [];
                        }
                    }
                } else {
                    validateAlignmentReview(config);
                }
                validateMatchingSections(configToPersist);
            } catch (err) {
                return res.status(422).json({
                    error: err.message,
                    code: err.code || 'INVALID_ALIGNMENT_CONFIG',
                });
            }
            const updated = await updateOwnedSessionConfig(
                pool,
                parsedSessionId,
                req.user.orgId,
                configToPersist,
                { expectedRevision: requiresReviewBoundary ? expectedRevision : null },
            );
            if (!updated) {
                return res.status(requiresReviewBoundary ? 409 : 404).json({
                    error: requiresReviewBoundary ? 'This review changed in another session. Refresh before saving.' : 'Session not found',
                });
            }
            res.json({ success: true, sessionId: parsedSessionId, sessionRevision: updated.revision });
        } else {
            if (hasReviewEvidence(config)) {
                return res.status(422).json({ error: 'Review evidence requires an existing alignment session' });
            }
            try {
                validateMatchingSections(config);
                validateAlignmentReview(config);
            } catch (err) {
                return res.status(422).json({
                    error: err.message,
                    code: err.code || 'INVALID_ALIGNMENT_CONFIG',
                });
            }
            const created = await createOwnedSession(pool, config, req.user);
            if (!created) {
                return res.status(400).json({ error: 'Pipeline does not belong to your organization' });
            }
            res.status(201).json({ success: true, sessionId: created.id, sessionRevision: created.revision });
        }
    } catch (err) {
        console.error("Save state error:", err);
        res.status(500).json({ error: 'Failed to save state' });
    }
};

exports.getWizardSession = async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid session ID' });
    try {
        const session = await findOwnedSession(pool, id, req.user.orgId);
        if (session) {
            res.json({ config: session.params_json, sessionId: session.id, status: session.status, sessionRevision: session.revision });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (err) {
        console.error("Get session error:", err);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
};

exports.saveSections = async (req, res) => {
    const { sessionId, sections, pipelineRoute } = req.body;
    try {
        const parsedSessionId = parsePositiveId(sessionId);
        if (!parsedSessionId) return res.status(400).json({ error: 'Session ID required' });
        if (!Array.isArray(sections) || sections.length > 5_000) {
            return res.status(400).json({ error: 'Sections must be an array with at most 5000 items' });
        }
        if (pipelineRoute !== undefined) {
            const routeIsValid = Array.isArray(pipelineRoute)
                && pipelineRoute.length <= 10_000
                && pipelineRoute.every((point) => Array.isArray(point)
                    && point.length === 2
                    && Number.isFinite(Number(point[0]))
                    && Number.isFinite(Number(point[1]))
                    && Number(point[0]) >= -90
                    && Number(point[0]) <= 90
                    && Number(point[1]) >= -180
                    && Number(point[1]) <= 180);
            if (!routeIsValid) {
                return res.status(400).json({ error: 'Pipeline route must contain valid [latitude, longitude] points' });
            }
        }
        const session = await findOwnedSession(pool, parsedSessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const config = {
            ...(session.params_json || {}),
            sections,
            ...(pipelineRoute === undefined ? {} : { pipelineRoute }),
        };
        const updated = await updateOwnedSessionConfig(
            pool,
            parsedSessionId,
            req.user.orgId,
            config,
        );
        if (!updated) return res.status(404).json({ error: 'Session not found' });
        res.json({ success: true });
    } catch (err) {
        console.error("Save sections error:", err);
        res.status(500).json({ error: 'Failed to save sections' });
    }
};

exports.saveIntervention = async (req, res) => {
    const parsedSessionId = parsePositiveId(req.body?.sessionId);
    if (!parsedSessionId) return res.status(400).json({ error: 'Session ID required' });
    try {
        const event = {
            ...normalizeInterventionEvent(req.body?.event),
            createdByUserId: Number(req.user.id),
        };
        const session = await findOwnedSession(pool, parsedSessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const existing = Array.isArray(session.params_json?.interventions)
            ? session.params_json.interventions
            : [];
        if (existing.length >= 10_000) {
            return res.status(400).json({ error: 'Intervention event limit reached' });
        }
        const interventions = existing.some((item) => item.id === event.id)
            ? existing
            : [...existing, event];
        const config = { ...(session.params_json || {}), interventions };
        const updated = await updateOwnedSessionConfig(pool, parsedSessionId, req.user.orgId, config);
        if (!updated) return res.status(404).json({ error: 'Session not found' });
        return res.status(201).json({ success: true, event, count: interventions.length });
    } catch (error) {
        if (error?.code === 'INVALID_INTERVENTION') {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        console.error('Save intervention error:', error);
        return res.status(500).json({ error: 'Failed to save intervention' });
    }
};

exports.getPipelineRuns = async (req, res) => {
    try {
        const sessions = await listOwnedSessions(pool, req.user.orgId);

        const runs = sessions.map(row => {
            const params = row.params_json || {};
            const summaryData = params.summaryData || {};
            const resultSummary = params.resultSummary || {};
            const pipelineName = summaryData.sessionName
                || summaryData.pipelineName
                || row.stored_pipeline_name
                || `Run ${row.id}`;
            const vendorOld = summaryData.oldRun?.name || 'Old';
            const vendorNew = summaryData.newRun?.name || 'New';
            
            return {
                id: row.id.toString(),
                pipelineName: pipelineName,
                date: row.started_at,
                status: row.status,
                matchRate: Number.isFinite(Number(resultSummary.matchRate))
                    ? Number(resultSummary.matchRate)
                    : null,
                anomaliesFound: Number(resultSummary.anomaliesFound) || 0,
                vendorLama: vendorOld,
                vendorBaru: vendorNew
            };
        });
        
        res.json(runs);
    } catch (err) {
        console.error("Get pipeline runs error:", err);
        res.status(500).json({ error: 'Failed to fetch pipeline runs' });
    }
};


exports.resumeWizardState = async (req, res) => {
    try {
        const session = await findLatestOwnedSession(
            pool,
            req.user.orgId,
            { status: 'in_progress' },
        );

        if (session) {
            res.json({ success: true, sessionId: session.id, sessionRevision: session.revision, config: session.params_json });
        } else {
            res.json({ success: false, message: 'No session to resume' });
        }
    } catch (err) {
        console.error("Resume state error:", err);
        res.status(500).json({ error: 'Failed to resume state' });
    }
};

exports.getIliResults = async (req, res) => {
    try {
        const requestedSessionId = req.query.sessionId
            ? parsePositiveId(req.query.sessionId)
            : null;
        if (req.query.sessionId && !requestedSessionId) {
            return res.status(400).json({ error: 'Invalid session ID' });
        }

        const session = requestedSessionId
            ? await findOwnedSession(pool, requestedSessionId, req.user.orgId)
            : await findLatestOwnedSession(pool, req.user.orgId, { requireData: true });

        if (!session && requestedSessionId) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!session) {
            return res.json({ comparison: [] });
        }

        const resolvedSessionId = session.id;

        const previousJob = await getLatestAlignmentJob(pool, resolvedSessionId, req.user.orgId);
        if (isReusableAlignmentJob(previousJob, session.params_json)) {
            return res
                .status(previousJob.state === 'completed' ? 200 : 202)
                .json(buildReusableAlignmentJobResponse(previousJob));
        }

        const jobId = randomUUID();
        const configFingerprint = alignmentConfigFingerprint(session.params_json);
        const configuredAlgorithm = session.params_json?.algorithm
            || session.params_json?.summaryData?.algorithm
            || 'dtw_hungarian';
        const strategyCapability = getAlignmentStrategyCapability(configuredAlgorithm);
        if (!strategyCapability.available) {
            return res.status(422).json({
                error: `Alignment strategy "${strategyCapability.id}" is not available for execution.`,
                code: 'ALIGNMENT_STRATEGY_NOT_AVAILABLE',
                strategy: strategyCapability.id,
            });
        }
        await createAlignmentJob(pool, {
            jobId,
            sessionId: resolvedSessionId,
            organizationId: req.user.orgId,
            userId: req.user.id,
            engineVersion: ALIGNMENT_ENGINE_VERSION,
            configFingerprint,
        });
        try {
            await alignmentQueue.add('align-ili', {
                jobId,
                sessionId: resolvedSessionId,
                organizationId: req.user.orgId,
                userId: req.user.id,
                algorithm: configuredAlgorithm,
                engineVersion: ALIGNMENT_ENGINE_VERSION,
                configFingerprint,
            }, { jobId });
        } catch (queueError) {
            // Mirrors enqueueIngestion: with Redis down the durable row would
            // otherwise stay 'queued' forever, and the reuse check above would
            // keep answering 202 for this session with no worker ever coming.
            console.error('Failed to queue alignment job:', queueError);
            await updateAlignmentJob(pool, jobId, {
                state: 'failed',
                errorCode: 'QUEUE_UNAVAILABLE',
                errorMessage: 'Alignment queue is unavailable',
                completedAt: new Date(),
            });
            return res.status(503).json({
                error: 'Alignment queue is unavailable',
                code: 'ALIGNMENT_QUEUE_UNAVAILABLE',
            });
        }
        return res.status(202).json({
            success: true,
            jobId,
            state: 'queued',
            progress: 0,
            message: 'Alignment job queued',
        });


    } catch (err) {
        console.error("Failed to get ILI results:", err);
        res.status(500).json({ error: 'Failed to get ILI results' });
    }
};

exports.getJobResult = async (req, res) => {
    const { jobId } = req.params;
    try {
        const durableJob = await getOwnedAlignmentJob(pool, jobId, req.user.orgId);
        if (durableJob) return res.json(serializeAlignmentJob(durableJob));
        return res.status(404).json({ error: 'Job not found' });
    } catch (err) {
        console.error("Get job result error:", err);
        res.status(500).json({ error: 'Failed to get job status' });
    }
};

exports.deletePipelineRun = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });

    try {
        const deleted = await deleteOwnedSession(pool, sessionId, req.user.orgId);
        if (!deleted) return res.status(404).json({ error: 'Session not found' });
        return res.status(204).send();
    } catch (err) {
        console.error('Delete pipeline run error:', err);
        return res.status(500).json({ error: 'Failed to delete pipeline run' });
    }
};

exports.exportExcel = async (req, res) => {
    let payload;
    try {
        payload = normalizeAlignmentExportPayload(req.body, { maxRows: MAX_EXPORT_ROWS });
    } catch (error) {
        const tooLarge = String(error.message).includes('limited to');
        return res.status(tooLarge ? 413 : 400).json({
            error: error.message,
            code: error.code || 'INVALID_EXPORT_PAYLOAD',
        });
    }

    let excelExport;
    try {
        excelExport = await createExcelExport(payload);
    } catch (err) {
        if (err.code === 'EXPORT_BUSY') {
            res.set('Retry-After', '10');
            return res.status(429).json({ error: err.message, code: 'EXPORT_BUSY' });
        }
        if (err.code === 'EXPORT_TIMEOUT') {
            return res.status(504).json({ error: err.message, code: 'EXPORT_TIMEOUT' });
        }
        if (err.code === 'EXPORT_FAILED') {
            return res.status(500).json({ error: err.message });
        }
        console.error('Failed to export Excel:', err);
        return res.status(500).json({ error: 'Failed to export Excel' });
    }

    // The concurrency slot stays held until the download finishes; release
    // removes the temp workbook and frees the slot exactly once.
    res.download(excelExport.filePath, 'synapse_alignment_report.xlsx', () => {
        excelExport.release();
    });
};
