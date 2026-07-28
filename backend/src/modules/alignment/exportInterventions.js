function present(value) {
    return value !== undefined && value !== null && value !== '' && value !== '-';
}

function exclusionSide(row) {
    const hasOld = present(row['Source Key OLD']) || present(row['Identif. OLD']);
    const hasNew = present(row['Source Key NEW']) || present(row['Identif. NEW']);
    if (hasOld === hasNew) return null;
    return hasOld ? 'OLD' : 'NEW';
}

function sourceKey(row, side) {
    const value = row[`Source Key ${side}`];
    return present(value) ? String(value) : null;
}

function pairIndex(row) {
    const value = Number(row.pair_index);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sideDistance(row, side) {
    const value = Number(row[`Log Dist ${side} (m)`]);
    return Number.isFinite(value) ? value : null;
}

function createExportInterventionCollector(events = []) {
    const validEvents = Array.isArray(events)
        ? events.filter((event) => event && typeof event === 'object')
        : [];
    const requestedKeys = { OLD: new Set(), NEW: new Set() };

    for (const event of validEvents) {
        if (event.type === 'REASSIGN_NEW') {
            requestedKeys.NEW.add(String(event.sourceNewKey));
            requestedKeys.OLD.add(String(event.targetOldKey));
        } else if (event.type === 'EXCLUDE_FEATURE') {
            requestedKeys[event.side]?.add(String(event.sourceKey));
        } else if (event.type === 'EXCLUDE_RANGE') {
            requestedKeys[event.side]?.add(String(event.startSourceKey));
            requestedKeys[event.side]?.add(String(event.endSourceKey));
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
        const findCurrentRow = (side, key) => retainedRows.find(
            (row) => sourceKey(row, side) === String(key),
        );

        for (const event of validEvents) {
            if (event.type !== 'REASSIGN_NEW') continue;
            const source = findCurrentRow('NEW', event.sourceNewKey);
            const target = findCurrentRow('OLD', event.targetOldKey);
            if (!source || !target || source === target) continue;
            if (sourceKey(source, 'NEW') !== String(event.sourceNewKey)) continue;
            if (sourceKey(target, 'OLD') !== String(event.targetOldKey)) continue;
            if (present(target['Source Key NEW'])) continue;

            const payload = Object.fromEntries(
                Object.entries(source).filter(([key]) => (
                    key.includes('NEW') || key === "O'Clock NEW"
                )),
            );
            for (const [key, value] of Object.entries(payload)) {
                target[key] = value;
                source[key] = typeof value === 'number' ? Number.NaN : '-';
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
                exclusionSide(row) === event.side
                && pairIndex(row) === Number(event.pairIndex)
            ));
            const start = candidates.find(
                (row) => sourceKey(row, event.side) === String(event.startSourceKey),
            );
            const end = candidates.find(
                (row) => sourceKey(row, event.side) === String(event.endSourceKey),
            );
            const startDistance = start ? sideDistance(start, event.side) : null;
            const endDistance = end ? sideDistance(end, event.side) : null;
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

function transformExportRow(row, ordinal, plan) {
    const transformed = plan?.overrides?.get(ordinal) ?? row;
    if (!present(transformed['Identif. OLD']) && !present(transformed['Identif. NEW'])) {
        return null;
    }

    const side = exclusionSide(transformed);
    const scopedExclusions = side && plan?.exclusionsByScope
        ? plan.exclusionsByScope.get(`${side}:${pairIndex(transformed)}`) ?? []
        : plan?.exclusions ?? [];
    for (const exclusion of scopedExclusions) {
        if (side !== exclusion.side) continue;
        if (pairIndex(transformed) !== Number(exclusion.pairIndex)) continue;
        if (exclusion.type === 'feature') {
            if (sourceKey(transformed, exclusion.side) === exclusion.sourceKey) return null;
            continue;
        }
        const distance = sideDistance(transformed, exclusion.side);
        if (distance !== null && distance >= exclusion.lower && distance <= exclusion.upper) {
            return null;
        }
    }
    return transformed;
}

module.exports = {
    buildExportInterventionPlan,
    createExportInterventionCollector,
    transformExportRow,
};
