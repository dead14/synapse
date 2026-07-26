const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Client } = require('pg');
const { buildDatabaseConfig } = require('./databaseConfig');
const { orderMigrationFiles } = require('./migrationOrdering');
const { pythonExecutable, pythonEnv } = require('./python');

const execFileAsync = promisify(execFile);
const MIGRATION_ADVISORY_LOCK_ID = 213740985;

function databaseUrlForPython(env = process.env) {
    const config = buildDatabaseConfig(env);
    if (config.connectionString) return config.connectionString;

    const databaseUrl = new URL('postgresql://localhost');
    databaseUrl.hostname = config.host;
    databaseUrl.port = String(config.port);
    databaseUrl.username = config.user;
    databaseUrl.password = config.password;
    databaseUrl.pathname = `/${config.database}`;
    if (config.ssl) {
        databaseUrl.searchParams.set(
            'sslmode',
            config.ssl.rejectUnauthorized ? 'verify-full' : 'require',
        );
    }
    return databaseUrl.toString();
}

async function ensureBaseSchema(dependencies = {}) {
    // SQLAlchemy models are the canonical definition for a fresh installation.
    // Create those tables before applying additive SQL migrations.
    const run = dependencies.execFile || execFileAsync;
    const env = dependencies.env || process.env;
    await run(
        dependencies.pythonExecutable || pythonExecutable,
        ['-c', 'from src.python_engines.models import init_db; init_db()'],
        {
            cwd: path.join(__dirname, '../..'),
            env: {
                ...(dependencies.pythonEnv || pythonEnv()),
                DATABASE_URL: databaseUrlForPython(env),
            },
        },
    );
}

async function syncParserDictionary(dependencies = {}) {
    const run = dependencies.execFile || execFileAsync;
    const env = dependencies.env || process.env;
    await run(
        dependencies.pythonExecutable || pythonExecutable,
        ['src/python_engines/seed_dictionary.py'],
        {
            cwd: path.join(__dirname, '../..'),
            env: {
                ...(dependencies.pythonEnv || pythonEnv()),
                DATABASE_URL: databaseUrlForPython(env),
            },
        },
    );
}

async function parserDictionaryReadiness(query) {
    const result = await query(`
        SELECT
            EXISTS (SELECT 1 FROM field_synonym_dictionary LIMIT 1) AS field_ready,
            EXISTS (SELECT 1 FROM feature_type_synonym LIMIT 1) AS feature_ready
    `);
    const row = result.rows[0] || {};
    return Boolean(row.field_ready && row.feature_ready);
}

async function ensureParserDictionary(query, dependencies = {}) {
    const synchronize = dependencies.syncParserDictionary
        || (() => syncParserDictionary(dependencies));
    await synchronize();

    if (!(await parserDictionaryReadiness(query))) {
        throw new Error('Parser dictionary synchronization completed without any usable records');
    }
}

function createMigrationClient(env = process.env) {
    return new Client({
        ...buildDatabaseConfig(env),
        application_name: 'synapse-migrator',
        query_timeout: 0,
        statement_timeout: 0,
    });
}

async function withDatabaseMigrationLock(client, callback) {
    await client.connect();
    let locked = false;
    try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
        locked = true;
        return await callback(client.query.bind(client));
    } finally {
        try {
            if (locked) {
                await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
            }
        } finally {
            await client.end();
        }
    }
}

async function applyDatabaseSchema(query, dependencies) {
    const initBaseSchema = dependencies.initBaseSchema || (() => ensureBaseSchema(dependencies));
    const readFile = dependencies.readFile || fs.readFile;
    const readdir = dependencies.readdir || fs.readdir;
    const migrationDirectory = path.join(__dirname, '../../migrations');
    // Validate the complete manifest before touching the database. A malformed
    // release must fail without creating tables or partially initializing a
    // fresh installation.
    const migrationFiles = orderMigrationFiles(await readdir(migrationDirectory));
    let baseSchemaExists = false;

    try {
        const tableCheck = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                  AND table_name = 'users'
            );
        `);
        baseSchemaExists = Boolean(tableCheck.rows[0]?.exists);
    } catch (err) {
        console.warn("Table check failed, proceeding with initialization:", err.message);
    }

    if (!baseSchemaExists) {
        await initBaseSchema();
    }

    // The ledger is intentionally independent of the Python/SQLAlchemy base
    // schema. Existing installations therefore receive additive migrations
    // instead of returning early simply because the first table exists.
    await query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            migration_name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    const appliedResult = await query(
        'SELECT migration_name FROM schema_migrations ORDER BY migration_name',
    );
    const applied = new Set(appliedResult.rows.map((row) => row.migration_name));
    for (const migrationName of migrationFiles) {
        if (applied.has(migrationName)) continue;

        const migrationPath = path.join(migrationDirectory, migrationName);
        const sql = await readFile(migrationPath, 'utf8');

        await query('BEGIN');
        try {
            await query(sql);
            await query(
                `INSERT INTO schema_migrations (migration_name)
                 VALUES ($1)
                 ON CONFLICT (migration_name) DO NOTHING`,
                [migrationName],
            );
            await query('COMMIT');
        } catch (error) {
            await query('ROLLBACK');
            throw error;
        }
    }

    // The importer workbook is release data, not a manual server prerequisite.
    // Always run its idempotent sync so new aliases ship with a release. Keep
    // it inside the migration lock so concurrent API instances cannot seed at
    // the same time.
    await ensureParserDictionary(query, dependencies);
}

async function ensureDatabaseSchema(dependencies = {}) {
    if (dependencies.query) {
        return applyDatabaseSchema(dependencies.query, dependencies);
    }
    const migrationClient = dependencies.migrationClient
        || createMigrationClient(dependencies.env || process.env);
    return withDatabaseMigrationLock(
        migrationClient,
        (query) => applyDatabaseSchema(query, dependencies),
    );
}

module.exports = {
    databaseUrlForPython,
    ensureBaseSchema,
    ensureDatabaseSchema,
    ensureParserDictionary,
    syncParserDictionary,
    createMigrationClient,
    withDatabaseMigrationLock,
};
