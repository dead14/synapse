const test = require('node:test');
const assert = require('node:assert/strict');
const { readdir } = require('node:fs/promises');
const path = require('node:path');

const {
    assertUniqueMigrationOrdinals,
    orderMigrationFiles,
} = require('../src/config/migrationOrdering');

const MIGRATION_DIR = path.join(__dirname, '..', 'migrations');

test('the migrations on disk pass the ordinal guard', async () => {
    const files = (await readdir(MIGRATION_DIR))
        .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
        .sort((left, right) => left.localeCompare(right));

    assert.ok(files.length > 0, 'expected migration files to exist');
    assert.doesNotThrow(() => assertUniqueMigrationOrdinals(files));
});

test('a new duplicate ordinal is rejected', () => {
    assert.throws(
        () => assertUniqueMigrationOrdinals([
            '001_tenant_ownership.sql',
            '008_alpha.sql',
            '008_beta.sql',
        ]),
        /Duplicate migration ordinal 008/,
    );
});

test('zero padding cannot hide a duplicate migration ordinal', () => {
    assert.throws(
        () => assertUniqueMigrationOrdinals(['8_alpha.sql', '008_beta.sql']),
        /numeric ordinal 8/,
    );
});

test('migration files are ordered by numeric ordinal instead of filename locale', () => {
    assert.deepEqual(
        orderMigrationFiles(['010_ten.sql', 'README.md', '2_two.sql', '001_one.sql']),
        ['001_one.sql', '2_two.sql', '010_ten.sql'],
    );
});

test('malformed SQL migration filenames fail closed', () => {
    assert.throws(
        () => orderMigrationFiles(['001_valid.sql', 'next_migration.sql']),
        /Invalid migration filename: next_migration\.sql/,
    );
});

test('adding a third file to the grandfathered 005 pair is rejected', () => {
    assert.throws(
        () => assertUniqueMigrationOrdinals([
            '005_big_data_anchor_index.sql',
            '005_field_measurements.sql',
            '005_something_new.sql',
        ]),
        /Duplicate migration ordinal 005/,
    );
});

test('the known 005 pair alone is grandfathered', () => {
    assert.doesNotThrow(() => assertUniqueMigrationOrdinals([
        '004_direct_assessment_field.sql',
        '005_big_data_anchor_index.sql',
        '005_field_measurements.sql',
        '006_durable_jobs.sql',
    ]));
});

test('unique ordinals are always accepted', () => {
    assert.doesNotThrow(() => assertUniqueMigrationOrdinals([
        '001_a.sql', '002_b.sql', '003_c.sql',
    ]));
    assert.doesNotThrow(() => assertUniqueMigrationOrdinals([]));
});

test('migration files leave transaction ownership to the atomic runner', async () => {
    const { readFile } = require('node:fs/promises');
    const files = (await readdir(MIGRATION_DIR)).filter((name) => name.endsWith('.sql'));

    for (const fileName of files) {
        const sql = (await readFile(path.join(MIGRATION_DIR, fileName), 'utf8')).toUpperCase();
        assert.doesNotMatch(
            sql,
            /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m,
            `${fileName} must not end the runner-owned transaction`,
        );
        const creates = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)/g)];
        assert.equal(
            creates.length,
            0,
            `${fileName} has a CREATE without IF NOT EXISTS; replay after a crash would fail`,
        );
    }
});
