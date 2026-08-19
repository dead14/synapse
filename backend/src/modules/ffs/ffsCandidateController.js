const pool = require('../../config/db');
const { parseFfsCandidateSelection } = require('./ffsCandidateContract');
const {
    findOwnedSessionForReview,
    listFfsCandidates,
    listResultSourceKeys,
    listReviewedSessions,
    replaceFfsCandidates,
} = require('./ffsCandidateRepository');
const {
    currentResultSignature,
    evaluateSession,
    finalPhaseRejection,
    parseParams,
} = require('./ffsEligibility');
const { isoCalendarDate } = require('../ingestion/surveyDate');

function parsePositiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sessionLabel(row) {
    const params = parseParams(row);
    const summaryData = params.summaryData || {};
    return summaryData.sessionName
        || summaryData.pipelineName
        || row.stored_pipeline_name
        || `Run ${row.id}`;
}

/**
 * The date the assessed run was flown, from the session's own master run.
 *
 * FFS dates its assessment from the newest run in the comparison — that is the
 * inspection whose depths are being assessed — so this reads the master (NEW)
 * side and falls back to the newest date on any run in the session. Null for a
 * session built before the intake collected dates; the setup screen then asks
 * for one instead of guessing.
 */
function sessionInspectionDate(row) {
    const summaryData = parseParams(row).summaryData || {};
    const candidates = [
        summaryData.masterRun,
        summaryData.newRun,
        ...(Array.isArray(summaryData.historicalRuns) ? summaryData.historicalRuns : []),
        summaryData.oldRun,
    ];
    const dates = candidates
        .map((run) => isoCalendarDate(run && run.surveyDate))
        .filter((value) => value !== null);
    if (dates.length === 0) return null;
    const master = isoCalendarDate(
        (summaryData.masterRun && summaryData.masterRun.surveyDate)
        || (summaryData.newRun && summaryData.newRun.surveyDate),
    );
    // ISO dates sort lexicographically, so the plain max is the newest run.
    return master || dates.reduce((newest, value) => (value > newest ? value : newest));
}

exports.getCandidates = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });

    try {
        const session = await findOwnedSessionForReview(pool, sessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'Alignment session not found' });

        const items = await listFfsCandidates(pool, sessionId, req.user.orgId);
        const signature = currentResultSignature(session);
        const gateA = finalPhaseRejection(session);
        const stale = items.length > 0 && items.some((item) => item.signature !== signature);

        return res.json({
            sessionId,
            signature,
            stale,
            reviewable: gateA === null,
            reason: gateA,
            // A stale review is returned rather than hidden: the engineer should
            // see the previous decisions while re-reviewing the new result.
            items,
        });
    } catch (error) {
        console.error('Get FFS candidates error:', error);
        return res.status(500).json({ error: 'Failed to load the Corrosion Analysis review' });
    }
};

exports.saveCandidates = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });

    let payload;
    try {
        payload = parseFfsCandidateSelection(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_FFS_CANDIDATE_REVIEW' });
    }

    try {
        const session = await findOwnedSessionForReview(pool, sessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'Alignment session not found' });

        const gateA = finalPhaseRejection(session);
        if (gateA) {
            return res.status(409).json({ error: gateA, code: 'ALIGNMENT_NOT_FINAL_PHASE' });
        }

        const signature = currentResultSignature(session);
        if (payload.signature !== signature) {
            return res.status(409).json({
                error: 'The alignment result changed since this review was opened. Reload and review it again.',
                code: 'STALE_FFS_CANDIDATE_REVIEW',
                signature,
            });
        }

        const knownKeys = await listResultSourceKeys(pool, sessionId, req.user.orgId);
        const unknown = payload.items
            .map((item) => item.sourceKey)
            .filter((key) => !knownKeys.has(key));
        if (unknown.length > 0) {
            return res.status(422).json({
                error: `${unknown.length} feature key(s) are not part of this alignment result.`,
                code: 'UNKNOWN_FFS_CANDIDATE_KEY',
                keys: unknown.slice(0, 20),
            });
        }

        const items = await replaceFfsCandidates(pool, {
            sessionId,
            orgId: req.user.orgId,
            userId: req.user.id,
            signature,
            items: payload.items,
        });

        // The same shape the GET answers with. Omitting the gate made the page
        // that had just saved a review read `reviewable: undefined`, put the
        // "this session cannot be released to FFS" warning on screen with no
        // reason, and disable the very button that had worked a moment before.
        // Gate A was cleared above, so this save is releasable by definition.
        return res.json({
            sessionId,
            signature,
            stale: false,
            reviewable: true,
            reason: null,
            selectedCount: items.filter((item) => item.selected).length,
            items,
        });
    } catch (error) {
        console.error('Save FFS candidates error:', error);
        return res.status(500).json({ error: 'Failed to save the Corrosion Analysis review' });
    }
};

exports.listEligibleSessions = async (req, res) => {
    try {
        const rows = await listReviewedSessions(pool, req.user.orgId);
        const items = [];
        const blocked = [];

        for (const row of rows) {
            const verdict = evaluateSession(row, row);
            const entry = {
                id: String(row.id),
                pipelineName: sessionLabel(row),
                // The line this session ran on. FFS reads the pipeline dossier
                // through it, so the design data an engineer filed at intake
                // does not have to be typed a second time here.
                pipelineId: row.pipeline_id === null || row.pipeline_id === undefined
                    ? null
                    : Number(row.pipeline_id),
                inspectionDate: sessionInspectionDate(row),
                completedAt: row.completed_at,
                reviewedAt: row.reviewed_at,
                selectedCount: Number(row.selected_count) || 0,
                reviewedCount: Number(row.reviewed_count) || 0,
                // Whether this session's saved review can be used as the intake
                // scope. A session with none is still assessable — against every
                // anomaly the run reported.
                releaseAvailable: verdict.release.available,
                releaseReason: verdict.release.reason,
                releaseStale: verdict.release.stale,
            };
            if (verdict.eligible) items.push(entry);
            else blocked.push({ ...entry, reason: verdict.reason, stale: verdict.stale });
        }

        return res.json({ items, blocked });
    } catch (error) {
        console.error('List FFS-eligible sessions error:', error);
        return res.status(500).json({ error: 'Failed to load FFS-eligible alignment sessions' });
    }
};
