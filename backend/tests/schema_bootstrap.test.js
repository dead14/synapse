const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const { ensureDatabaseSchema } = require('../src/config/schema');

test('creates the base schema before applying tenant migrations', async () => {
    const calls = [];

    await ensureDatabaseSchema({
        initBaseSchema: async () => calls.push('base'),
        readFile: async () => {
            calls.push('read');
            return 'SELECT 1;';
        },
        query: async (sql) => {
            if (sql.includes('information_schema.tables')) {
                return { rows: [{ exists: false }] };
            }
            calls.push(sql);
            return { rows: [] };
        },
    });

    assert.deepEqual(calls, ['base', 'read', 'SELECT 1;']);
});
