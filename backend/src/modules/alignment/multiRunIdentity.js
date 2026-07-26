// Star topology for sessions holding more than two inspection runs.
//
// Chain alignment links consecutive runs, which makes every link depend on the
// weakest run in the middle: one sparse or partial inspection breaks the trail
// for every year after it.  Corrosion growth needs the opposite property, so
// every historical run is anchored directly to a single reference run and a bad
// run can only spoil itself.
//
// A two-run session yields exactly one pair either way, so this is a superset
// of the pairwise behaviour rather than a replacement — the existing two-run
// path must keep resolving exactly what it resolves today.
//
// Mirrored in `frontend/src/domain/multiRun.ts`; change both together.

const { parsePositiveId, runPairKey } = require('./runPairIdentity');

function runYear(run) {
    const parsed = Number(run?.year ?? run?.surveyYear);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every persisted inspection run in a session, oldest first.
 *
 * Runs are gathered from every shape the wizard has written — the run-pair
 * chain, master/historical fields, and the phylogenetic run1..runN slots — so a
 * session saved by any client version resolves the same set.
 */
function resolveInspectionRuns(config) {
    const summary = config?.summaryData || {};
    const seen = new Map();
    const remember = (run) => {
        const runId = parsePositiveId(run?.runId);
        if (runId && !seen.has(runId)) seen.set(runId, run);
    };

    for (const pair of Array.isArray(summary.runPairs) ? summary.runPairs : []) {
        remember(pair?.oldRun);
        remember(pair?.newRun);
    }
    remember(summary.masterRun);
    remember(summary.newRun);
    remember(summary.oldRun);
    for (const run of Array.isArray(summary.historicalRuns) ? summary.historicalRuns : []) {
        remember(run);
    }
    remember(summary.ancestorRun);
    for (let index = 1; index <= 20; index += 1) remember(summary[`run${index}`]);

    return [...seen.entries()]
        .map(([runId, raw]) => ({ runId, year: runYear(raw), raw }))
        // Undated runs sort last rather than posing as the oldest, which would
        // let one of them become the reference by accident.
        .sort((left, right) => (
            (left.year ?? Infinity) - (right.year ?? Infinity) || left.runId - right.runId
        ));
}

/** A session comparing more than two inspections needs the multi-run path. */
function isMultiRunSession(config) {
    return resolveInspectionRuns(config).length > 2;
}

/**
 * The run every other run is measured against.
 *
 * The newest run is the default because growth analysis is about the defects
 * that exist now, but it can be overridden: when the newest inspection is a
 * short partial run, anchoring to it would discard every kilometre it never
 * covered.
 */
function resolveReferenceRun(config, preferredRunId) {
    const runs = resolveInspectionRuns(config);
    if (runs.length === 0) return null;
    const preferred = parsePositiveId(preferredRunId ?? config?.referenceRunId);
    if (preferred) {
        const chosen = runs.find((run) => run.runId === preferred);
        if (chosen) return chosen;
    }
    return runs[runs.length - 1];
}

/** One pair per historical run, each anchored to the reference run. */
function resolveStarRunPairs(config, preferredRunId) {
    const reference = resolveReferenceRun(config, preferredRunId);
    if (!reference) return [];
    return resolveInspectionRuns(config)
        .filter((run) => run.runId !== reference.runId)
        .map((run) => ({
            key: runPairKey(run.runId, reference.runId),
            oldRunId: run.runId,
            newRunId: reference.runId,
            oldRun: run.raw,
            newRun: reference.raw,
        }))
        .filter((pair) => pair.key !== null);
}

module.exports = {
    isMultiRunSession,
    resolveInspectionRuns,
    resolveReferenceRun,
    resolveStarRunPairs,
};
