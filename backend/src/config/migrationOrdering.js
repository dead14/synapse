// Pure migration-ordering rules.  Deliberately free of any database import so
// it can be exercised without a configured connection.

// Two migrations sharing an ordinal are ordered only by the alphabetical tail
// of their filename, so inserting a third with the same number silently
// reorders DDL.  005_big_data_anchor_index / 005_field_measurements are a
// pre-existing pair: their relative order is already recorded in every
// deployed ledger, so they are grandfathered rather than renamed (renaming
// re-runs a migration, since the ledger keys on filename).  Any *new*
// duplicate is rejected.
const LEGACY_DUPLICATE_ORDINALS = new Map([
    ['5', ['005_big_data_anchor_index.sql', '005_field_measurements.sql']],
]);

function migrationOrdinal(fileName) {
    const match = fileName.match(/^(\d+)_[a-z0-9_-]+\.sql$/i);
    if (!match) {
        if (fileName.toLowerCase().endsWith('.sql')) {
            throw new Error(`Invalid migration filename: ${fileName}`);
        }
        return null;
    }
    return BigInt(match[1]);
}

function assertUniqueMigrationOrdinals(migrationFiles) {
    const byOrdinal = new Map();
    for (const fileName of migrationFiles) {
        const ordinal = migrationOrdinal(fileName);
        if (ordinal === null) continue;
        const normalizedOrdinal = ordinal.toString();
        if (!byOrdinal.has(normalizedOrdinal)) byOrdinal.set(normalizedOrdinal, []);
        byOrdinal.get(normalizedOrdinal).push(fileName);
    }

    for (const [ordinal, files] of byOrdinal) {
        if (files.length < 2) continue;
        const grandfathered = LEGACY_DUPLICATE_ORDINALS.get(ordinal);
        const isKnownPair = grandfathered
            && files.length === grandfathered.length
            && files.every((file) => grandfathered.includes(file));
        if (isKnownPair) continue;

        const displayOrdinal = files[0].match(/^(\d+)_/)?.[1] || ordinal;
        throw new Error(
            `Duplicate migration ordinal ${displayOrdinal} (numeric ordinal ${ordinal}): ${files.join(', ')}. `
            + 'Migration order would depend on the filename suffix. '
            + 'Renumber one of these to the next unused ordinal.',
        );
    }
}

function orderMigrationFiles(directoryEntries) {
    const migrationFiles = directoryEntries.filter((fileName) => {
        const ordinal = migrationOrdinal(fileName);
        return ordinal !== null;
    });
    assertUniqueMigrationOrdinals(migrationFiles);
    return migrationFiles.sort((left, right) => {
        const leftOrdinal = migrationOrdinal(left);
        const rightOrdinal = migrationOrdinal(right);
        if (leftOrdinal < rightOrdinal) return -1;
        if (leftOrdinal > rightOrdinal) return 1;
        return left.localeCompare(right);
    });
}

module.exports = {
    assertUniqueMigrationOrdinals,
    LEGACY_DUPLICATE_ORDINALS,
    orderMigrationFiles,
};
