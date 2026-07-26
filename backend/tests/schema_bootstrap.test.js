const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
    databaseUrlForPython,
    ensureBaseSchema,
    ensureDatabaseSchema,
    syncParserDictionary,
    withDatabaseMigrationLock,
} = require('../src/config/schema');

test('base schema initialization uses the configured Python interpreter and UTF-8 environment', async () => {
    const calls = [];

    await ensureBaseSchema({
        execFile: async (...args) => calls.push(args),
        pythonExecutable: '/release/backend/venv/bin/python',
        pythonEnv: { PYTHONIOENCODING: 'utf-8' },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/release/backend/venv/bin/python');
    assert.deepEqual(calls[0][1], ['-c', 'from src.python_engines.models import init_db; init_db()']);
    assert.equal(calls[0][2].env.PYTHONIOENCODING, 'utf-8');
});

test('base schema initialization translates discrete DB settings for Python', async () => {
    const calls = [];

    await ensureBaseSchema({
        execFile: async (...args) => calls.push(args),
        env: {
            DB_HOST: 'db.internal',
            DB_PORT: '5433',
            DB_USER: 'synapse user',
            DB_PASSWORD: 'p@ss:/word',
            DB_NAME: 'synapse data',
        },
        pythonEnv: { PYTHONIOENCODING: 'utf-8' },
    });

    const databaseUrl = new URL(calls[0][2].env.DATABASE_URL);
    assert.equal(databaseUrl.protocol, 'postgresql:');
    assert.equal(databaseUrl.hostname, 'db.internal');
    assert.equal(databaseUrl.port, '5433');
    assert.equal(databaseUrl.username, 'synapse%20user');
    assert.equal(databaseUrl.password, 'p%40ss%3A%2Fword');
    assert.equal(databaseUrl.pathname, '/synapse%20data');
});

test('parser dictionary synchronization uses the release workbook through the configured Python', async () => {
    const calls = [];

    await syncParserDictionary({
        execFile: async (...args) => calls.push(args),
        pythonExecutable: '/release/backend/venv/bin/python',
        pythonEnv: { PYTHONIOENCODING: 'utf-8' },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/release/backend/venv/bin/python');
    assert.deepEqual(calls[0][1], ['src/python_engines/seed_dictionary.py']);
    assert.equal(calls[0][2].env.PYTHONIOENCODING, 'utf-8');
    assert.match(calls[0][2].env.DATABASE_URL, /^postgresql:/);
});

test('Python database URL preserves an explicit connection string', () => {
    const connectionString = 'postgresql://user:pass@db.example:5432/synapse?sslmode=require';
    assert.equal(databaseUrlForPython({ DATABASE_URL: connectionString }), connectionString);
});

test('production migrations hold one PostgreSQL advisory lock on one client', async () => {
    const calls = [];
    const client = {
        connect: async () => calls.push(['connect']),
        query: async (sql, values) => {
            calls.push(['query', sql, values]);
            return { rows: [] };
        },
        end: async () => calls.push(['end']),
    };

    const result = await withDatabaseMigrationLock(
        client,
        async (query) => {
            await query('SELECT work');
            return 'done';
        },
    );

    assert.equal(result, 'done');
    assert.deepEqual(calls[0], ['connect']);
    assert.match(calls[1][1], /pg_advisory_lock/);
    assert.equal(calls[2][1], 'SELECT work');
    assert.match(calls[3][1], /pg_advisory_unlock/);
    assert.deepEqual(calls[4], ['end']);
});

function createHarness({ baseExists, applied = [] }) {
    const calls = [];

    return {
        calls,
        dependencies: {
            initBaseSchema: async () => calls.push(['base']),
            syncParserDictionary: async () => {},
            readdir: async () => ['002_ingestion_evidence.sql', 'README.md', '001_tenant_ownership.sql'],
            readFile: async (filePath) => {
                const name = path.basename(filePath);
                calls.push(['read', name]);
                return `-- ${name}`;
            },
            query: async (sql, values) => {
                if (sql.includes('information_schema.tables')) {
                    return { rows: [{ exists: baseExists }] };
                }
                if (sql.includes('SELECT migration_name')) {
                    return { rows: applied.map((migrationName) => ({ migration_name: migrationName })) };
                }
                if (sql.includes('field_synonym_dictionary')) {
                    return { rows: [{ field_ready: true, feature_ready: true }] };
                }
                if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
                    calls.push(['ledger']);
                    return { rows: [] };
                }
                if (sql.includes('INSERT INTO schema_migrations')) {
                    calls.push(['mark', values[0]]);
                    return { rows: [] };
                }
                calls.push(['sql', sql]);
                return { rows: [] };
            },
        },
    };
}

test('creates the base schema and applies pending migrations in filename order', async () => {
    const harness = createHarness({ baseExists: false });

    await ensureDatabaseSchema(harness.dependencies);

    assert.deepEqual(harness.calls, [
        ['base'],
        ['ledger'],
        ['read', '001_tenant_ownership.sql'],
        ['sql', 'BEGIN'],
        ['sql', '-- 001_tenant_ownership.sql'],
        ['mark', '001_tenant_ownership.sql'],
        ['sql', 'COMMIT'],
        ['read', '002_ingestion_evidence.sql'],
        ['sql', 'BEGIN'],
        ['sql', '-- 002_ingestion_evidence.sql'],
        ['mark', '002_ingestion_evidence.sql'],
        ['sql', 'COMMIT'],
    ]);
});

test('applies migrations to an existing installation instead of returning early', async () => {
    const harness = createHarness({
        baseExists: true,
        applied: ['001_tenant_ownership.sql'],
    });

    await ensureDatabaseSchema(harness.dependencies);

    assert.deepEqual(harness.calls, [
        ['ledger'],
        ['read', '002_ingestion_evidence.sql'],
        ['sql', 'BEGIN'],
        ['sql', '-- 002_ingestion_evidence.sql'],
        ['mark', '002_ingestion_evidence.sql'],
        ['sql', 'COMMIT'],
    ]);
});

test('does not reapply migrations already recorded in the ledger', async () => {
    const harness = createHarness({
        baseExists: true,
        applied: ['001_tenant_ownership.sql', '002_ingestion_evidence.sql'],
    });

    await ensureDatabaseSchema(harness.dependencies);

    assert.deepEqual(harness.calls, [['ledger']]);
});

test('synchronizes and verifies the parser dictionary before startup completes', async () => {
    const calls = [];
    let readinessChecks = 0;

    await ensureDatabaseSchema({
        readdir: async () => [],
        syncParserDictionary: async () => calls.push('seed'),
        query: async (sql) => {
            if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
            if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
            if (sql.includes('SELECT migration_name')) return { rows: [] };
            if (sql.includes('field_synonym_dictionary')) {
                readinessChecks += 1;
                return { rows: [{ field_ready: true, feature_ready: true }] };
            }
            return { rows: [] };
        },
    });

    assert.deepEqual(calls, ['seed']);
    assert.equal(readinessChecks, 1);
});

test('refuses to start when parser dictionary synchronization leaves no usable records', async () => {
    await assert.rejects(
        ensureDatabaseSchema({
            readdir: async () => [],
            syncParserDictionary: async () => {},
            query: async (sql) => {
                if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
                if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
                if (sql.includes('SELECT migration_name')) return { rows: [] };
                if (sql.includes('field_synonym_dictionary')) {
                    return { rows: [{ field_ready: false, feature_ready: false }] };
                }
                return { rows: [] };
            },
        }),
        /without any usable records/i,
    );
});

test('rejects an invalid migration manifest before any database side effect', async () => {
    let queryCount = 0;

    await assert.rejects(
        ensureDatabaseSchema({
            query: async () => {
                queryCount += 1;
                return { rows: [] };
            },
            readdir: async () => ['001_valid.sql', 'migration_without_ordinal.sql'],
        }),
        /Invalid migration filename: migration_without_ordinal\.sql/,
    );

    assert.equal(queryCount, 0);
});

test('rolls back migration SQL and ledger insertion together on failure', async () => {
    const calls = [];

    await assert.rejects(
        ensureDatabaseSchema({
            initBaseSchema: async () => {},
            readdir: async () => ['001_broken.sql'],
            readFile: async () => '-- broken migration',
            query: async (sql) => {
                if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
                if (sql.includes('SELECT migration_name')) return { rows: [] };
                if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
                calls.push(sql);
                if (sql === '-- broken migration') throw new Error('migration failed');
                return { rows: [] };
            },
        }),
        /migration failed/,
    );

    assert.deepEqual(calls, ['BEGIN', '-- broken migration', 'ROLLBACK']);
});
