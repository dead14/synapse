const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const { ensureDatabaseSchema } = require('../src/config/schema');

function createHarness({ baseExists, applied = [] }) {
    const calls = [];

    return {
        calls,
        dependencies: {
            initBaseSchema: async () => calls.push(['base']),
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
        ['sql', '-- 001_tenant_ownership.sql'],
        ['mark', '001_tenant_ownership.sql'],
        ['read', '002_ingestion_evidence.sql'],
        ['sql', '-- 002_ingestion_evidence.sql'],
        ['mark', '002_ingestion_evidence.sql'],
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
        ['sql', '-- 002_ingestion_evidence.sql'],
        ['mark', '002_ingestion_evidence.sql'],
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
