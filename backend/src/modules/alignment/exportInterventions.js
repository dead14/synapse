/**
 * Server-side replay of the reviewer's intervention log for the Excel export.
 *
 * It must reach the same rows the browser shows, so every rule here mirrors
 * `frontend/src/utils/interventions.ts`: exclusions are scoped OLD, NEW or
 * PAIR; a reassignment can move either half onto a partner that lacks it; and
 * an unassignment splits a matched row back into the two single-run rows it was
 * built from. The export streams rows, so a split is emitted as an extra row
 * beside the one it came from.
 */

function present(value) {
    return value !== undefined && value !== null && value !== '' && value !== '-';
}

function hasSide(row, side) {
    return present(row[`Source Key ${side}`]) || present(row[`Identif. ${side}`]);
}

function exclusionSide(row) {
    const hasOld = hasSide(row, 'OLD');
    const hasNew = hasSide(row, 'NEW');
    if (hasOld === hasNew) return null;
    return hasOld ? 'OLD' : 'NEW';
}

function sourceKey(row, side) {
    const value = row[`Source Key ${side}`];
    return present(value) ? String(value) : null;
}

/** Scope a row belongs to for exclusion, and the key that names it there. */
function exclusionTarget(row) {
    if (hasSide(row, 'OLD') && hasSide(row, 'NEW')) {
        const key = sourceKey(row, 'OLD') ?? sourceKey(row, 'NEW');
        return key === null ? null : { side: 'PAIR', sourceKey: key };
    }
    const side = exclusionSide(row);
    if (!side) return null;
    const key = sourceKey(row, side);
    return key === null ? null : { side, sourceKey: key };
}

function pairIndex(row) {
    const value = Number(row.pair_index);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function scopeDistance(row, side) {
    const keys = side === 'PAIR'
        ? ['Log Dist NEW (m)', 'Log Dist OLD (m)']
        : [`Log Dist ${side} (m)`];
    for (const key of keys) {
        const value = Number(row[key]);
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function sideDistance(row, side) {
    const value = Number(row[`Log Dist ${side} (m)`]);
    return Number.isFinite(value) ? value : null;
}

function sideKeys(row, side) {
    return Object.keys(row).filter((key) => key.includes(side));
}

function blankValue(value) {
    return typeof value === 'number' ? Number.NaN : '-';
}

function createExportInterventionCollector(events = []) {
    const validEvents = Array.isArray(events)
        ? events.filter((event) => event && typeof event === 'object')
        : [];
    const requestedKeys = { OLD: new Set(), NEW: new Set() };
    const want = (side, key) => requestedKeys[side]?.add(String(key));

    for (const event of validEvents) {
        if (event.type === 'REASSIGN_NEW') {
            want('NEW', event.sourceNewKey);
            want('OLD', event.targetOldKey);
        } else if (event.type === 'REASSIGN_OLD') {
            want('OLD', event.sourceOldKey);
            want('NEW', event.targetNewKey);
        } else if (event.type === 'UNASSIGN_PAIR') {
            want('OLD', event.sourceOldKey);
            want('NEW', event.sourceNewKey);
        } else if (event.type === 'EXCLUDE_FEATURE') {
            // A PAIR exclusion is keyed on the OLD source key of the matched
            // row, so both single-run buckets have to be watched for it.
            if (event.side === 'PAIR') {
                want('OLD', event.sourceKey);
                want('NEW', event.sourceKey);
            } else {
                want(event.side, event.sourceKey);
            }
        } else if (event.type === 'EXCLUDE_RANGE') {
            for (const key of [event.startSourceKey, event.endSourceKey]) {
                if (event.side === 'PAIR') {
                    want('OLD', key);
                    want('NEW', key);
                } else {
                    want(event.side, key);
                }
            }
        }
    }

    const rowsByOrdinal = new Map();

    const observe = (row, ordinal) => {
        for (const side of ['OLD', 'NEW']) {
            const key = sourceKey(row, side);
            if (!key || !requestedKeys[side].has(key)) continue;
            if (!rowsByOrdinal.has(ordinal)) {
                rowsByOrdinal.set(ordinal, { ...row });
            }
        }
    };

    const finalize = () => {
        const restoredIds = new Set(
            validEvents
                .filter((event) => event.type === 'RESTORE_EXCLUSION')
                .map((event) => String(event.exclusionId)),
        );
        const retainedRows = [...rowsByOrdinal.values()];
        const ordinalOf = (target) => [...rowsByOrdinal.entries()]
            .find(([, row]) => row === target)?.[0] ?? null;
        const findCurrentRow = (side, key) => retainedRows.find(
            (row) => sourceKey(row, side) === String(key),
        );
        /** Rows created by splitting a match, keyed by the ordinal they came from. */
        const detachedByOrdinal = new Map();

        for (const event of validEvents) {
            if (event.type === 'UNASSIGN_PAIR') {
                const paired = retainedRows.find((row) => (
                    sourceKey(row, 'OLD') === String(event.sourceOldKey)
                    && sourceKey(row, 'NEW') === String(event.sourceNewKey)
                ));
                if (!paired || !(hasSide(paired, 'OLD') && hasSide(paired, 'NEW'))) continue;
                const detached = { ...paired };
                for (const key of sideKeys(paired, 'OLD')) detached[key] = blankValue(paired[key]);
                for (const key of sideKeys(paired, 'NEW')) paired[key] = blankValue(paired[key]);
                paired['Match/Unmatch'] = 'Only OLD';
                paired.match_status = 'Only OLD';
                detached['Match/Unmatch'] = 'Only NEW';
                detached.match_status = 'Only NEW';
                paired['Intervention ID'] = event.id;
                detached['Intervention ID'] = event.id;
                delete paired['Evidence Score'];
                delete detached['Evidence Score'];
                const ordinal = ordinalOf(paired);
                if (ordinal !== null) {
                    const siblings = detachedByOrdinal.get(ordinal) ?? [];
                    siblings.push(detached);
                    detachedByOrdinal.set(ordinal, siblings);
                }
                retainedRows.push(detached);
                continue;
            }

            if (event.type !== 'REASSIGN_NEW' && event.type !== 'REASSIGN_OLD') continue;
            const moving = event.type === 'REASSIGN_NEW' ? 'NEW' : 'OLD';
            const anchor = moving === 'NEW' ? 'OLD' : 'NEW';
            const movingKey = event.type === 'REASSIGN_NEW' ? event.sourceNewKey : event.sourceOldKey;
            const anchorKey = event.type === 'REASSIGN_NEW' ? event.targetOldKey : event.targetNewKey;
            const source = findCurrentRow(moving, movingKey);
            const target = findCurrentRow(anchor, anchorKey);
            if (!source || !target || source === target) continue;
            if (sourceKey(source, moving) !== String(movingKey)) continue;
            if (sourceKey(target, anchor) !== String(anchorKey)) continue;
            if (hasSide(target, moving)) continue;

            for (const key of sideKeys(source, moving)) {
                target[key] = source[key];
                source[key] = blankValue(source[key]);
            }
            target['Match/Unmatch'] = 'Match';
            target['Intervention ID'] = event.id;
            target['Evidence Score'] = event.evidenceScore;
        }

        const exclusions = [];
        for (const event of validEvents) {
            if (restoredIds.has(String(event.id))) continue;
            if (event.type === 'EXCLUDE_FEATURE') {
                exclusions.push({
                    type: 'feature',
                    side: event.side,
                    pairIndex: event.pairIndex,
                    sourceKey: String(event.sourceKey),
                });
                continue;
            }
            if (event.type !== 'EXCLUDE_RANGE') continue;
            const candidates = retainedRows.filter((row) => (
                exclusionTarget(row)?.side === event.side
                && pairIndex(row) === Number(event.pairIndex)
            ));
            const start = candidates.find(
                (row) => exclusionTarget(row)?.sourceKey === String(event.startSourceKey),
            );
            const end = candidates.find(
                (row) => exclusionTarget(row)?.sourceKey === String(event.endSourceKey),
            );
            const startDistance = start ? scopeDistance(start, event.side) : null;
            const endDistance = end ? scopeDistance(end, event.side) : null;
            if (startDistance === null || endDistance === null) continue;
            exclusions.push({
                type: 'range',
                side: event.side,
                pairIndex: event.pairIndex,
                lower: Math.min(startDistance, endDistance),
                upper: Math.max(startDistance, endDistance),
            });
        }

        const exclusionsByScope = new Map();
        for (const exclusion of exclusions) {
            const scope = `${exclusion.side}:${Number(exclusion.pairIndex)}`;
            const scoped = exclusionsByScope.get(scope) ?? [];
            scoped.push(exclusion);
            exclusionsByScope.set(scope, scoped);
        }
        return {
            overrides: rowsByOrdinal,
            detached: detachedByOrdinal,
            exclusions,
            exclusionsByScope,
        };
    };

    return { observe, finalize };
}

function buildExportInterventionPlan(rows, events) {
    const collector = createExportInterventionCollector(events);
    rows.forEach((row, index) => collector.observe(row, index + 1));
    return collector.finalize();
}

function isExcluded(row, plan) {
    const target = exclusionTarget(row);
    const scopedExclusions = target && plan?.exclusionsByScope
        ? plan.exclusionsByScope.get(`${target.side}:${pairIndex(row)}`) ?? []
        : plan?.exclusions ?? [];
    for (const exclusion of scopedExclusions) {
        if (!target || target.side !== exclusion.side) continue;
        if (pairIndex(row) !== Number(exclusion.pairIndex)) continue;
        if (exclusion.type === 'feature') {
            if (target.sourceKey === exclusion.sourceKey) return true;
            continue;
        }
        const distance = scopeDistance(row, exclusion.side);
        if (distance !== null && distance >= exclusion.lower && distance <= exclusion.upper) {
            return true;
        }
    }
    return false;
}

/**
 * The row as the reviewer sees it, or null when they excluded it. An
 * unassignment can turn one source row into two; use {@link expandExportRow}
 * to receive both.
 */
function transformExportRow(row, ordinal, plan) {
    const transformed = plan?.overrides?.get(ordinal) ?? row;
    if (!present(transformed['Identif. OLD']) && !present(transformed['Identif. NEW'])) {
        return null;
    }
    return isExcluded(transformed, plan) ? null : transformed;
}

/** Every released row this source row produced, in order. */
function expandExportRow(row, ordinal, plan) {
    const rows = [];
    const primary = transformExportRow(row, ordinal, plan);
    if (primary) rows.push(primary);
    for (const detached of plan?.detached?.get(ordinal) ?? []) {
        if (!present(detached['Identif. OLD']) && !present(detached['Identif. NEW'])) continue;
        if (!isExcluded(detached, plan)) rows.push(detached);
    }
    return rows;
}

module.exports = {
    buildExportInterventionPlan,
    createExportInterventionCollector,
    expandExportRow,
    transformExportRow,
};
