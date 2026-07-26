// Chain alignment compares N inspection runs as N-1 consecutive pairs, so every
// piece of per-pair evidence (tie-in transform, GW locks, review decisions,
// sections) has to be filed under a key both the wizard and the engines agree
// on.  Run ids are the only identity that survives a page reload and a worker
// restart, so the key is built from them alone; the frontend mirrors this format
// in `frontend/src/domain/runPairs.ts` and the two must stay byte-identical.

function parsePositiveId(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function runPairKey(oldRunId, newRunId) {
    const oldId = parsePositiveId(oldRunId);
    const newId = parsePositiveId(newRunId);
    return oldId && newId ? `${oldId}->${newId}` : null;
}

function pairKeyOf(pair) {
    return runPairKey(pair?.oldRun?.runId ?? pair?.oldRunId, pair?.newRun?.runId ?? pair?.newRunId);
}

function runYear(run) {
    const parsed = Number(run?.year ?? run?.surveyYear);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every run pair the session is allowed to align, oldest transition first.
 *
 * A stored `runPairs` chain wins because it records the operator's chosen
 * chronology.  Sessions saved before chain alignment existed only carry
 * `oldRun`/`newRun`, so those degrade to a single pair rather than failing.
 */
function resolveSessionRunPairs(config) {
    const summary = config?.summaryData || {};
    const stored = Array.isArray(summary.runPairs) ? summary.runPairs : [];
    const pairs = [];
    const seen = new Set();

    for (const pair of stored) {
        const oldRunId = parsePositiveId(pair?.oldRun?.runId);
        const newRunId = parsePositiveId(pair?.newRun?.runId);
        const key = runPairKey(oldRunId, newRunId);
        if (!key || oldRunId === newRunId || seen.has(key)) continue;
        seen.add(key);
        pairs.push({ key, oldRunId, newRunId, oldRun: pair.oldRun, newRun: pair.newRun });
    }
    if (pairs.length > 0) return pairs;

    const oldRunId = parsePositiveId(summary.oldRun?.runId);
    const newRunId = parsePositiveId(summary.newRun?.runId);
    const key = runPairKey(oldRunId, newRunId);
    if (!key || oldRunId === newRunId) return [];
    return [{ key, oldRunId, newRunId, oldRun: summary.oldRun, newRun: summary.newRun }];
}

/**
 * The pair a request is asking for, or null when it names runs this session
 * never uploaded.  Callers must treat null as a rejection: resolving an
 * arbitrary caller-supplied run id would let one organization align another
 * organization's persisted features.
 */
function findSessionRunPair(config, requested) {
    const pairs = resolveSessionRunPairs(config);
    const oldRunId = parsePositiveId(requested?.oldRunId);
    const newRunId = parsePositiveId(requested?.newRunId);
    if (!oldRunId || !newRunId) return null;
    return pairs.find((pair) => pair.oldRunId === oldRunId && pair.newRunId === newRunId) || null;
}

/**
 * The pair that owns the session's top-level (unscoped) evidence.  Legacy
 * sessions and single-pair runs keep writing `gwMatchesFinal` and friends at the
 * root, and the last transition into the master run is what those describe.
 */
function primarySessionRunPair(config) {
    const pairs = resolveSessionRunPairs(config);
    if (pairs.length === 0) return null;
    const masterRunId = parsePositiveId(config?.summaryData?.masterRun?.runId)
        ?? parsePositiveId(config?.summaryData?.newRun?.runId);
    if (masterRunId) {
        const intoMaster = pairs.filter((pair) => pair.newRunId === masterRunId);
        if (intoMaster.length > 0) {
            return intoMaster.reduce(
                (latest, pair) => ((runYear(pair.oldRun) ?? -Infinity) > (runYear(latest.oldRun) ?? -Infinity) ? pair : latest),
            );
        }
    }
    return pairs[pairs.length - 1];
}

module.exports = {
    findSessionRunPair,
    pairKeyOf,
    parsePositiveId,
    primarySessionRunPair,
    resolveSessionRunPairs,
    runPairKey,
};
