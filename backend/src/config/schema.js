const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const pool = require('./db');

const execFileAsync = promisify(execFile);

async function ensureBaseSchema() {
    // SQLAlchemy models are the canonical definition for a fresh installation.
    // Create those tables before applying additive SQL migrations.
    await execFileAsync(
        'python',
        ['-c', 'from src.python_engines.models import init_db; init_db()'],
        { cwd: path.join(__dirname, '../..') }
    );
}

async function ensureDatabaseSchema(dependencies = {}) {
    const query = dependencies.query || pool.query.bind(pool);
    const initBaseSchema = dependencies.initBaseSchema || ensureBaseSchema;
    const readFile = dependencies.readFile || fs.readFile;
    const readdir = dependencies.readdir || fs.readdir;
    const migrationDirectory = path.join(__dirname, '../../migrations');
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
    const migrationFiles = (await readdir(migrationDirectory))
        .filter((fileName) => /^\d+_[a-z0-9_-]+\.sql$/i.test(fileName))
        .sort((left, right) => left.localeCompare(right));

    for (const migrationName of migrationFiles) {
        if (applied.has(migrationName)) continue;

        const migrationPath = path.join(migrationDirectory, migrationName);
        const sql = await readFile(migrationPath, 'utf8');

        // Migration files are idempotent and own their transaction. If the
        // process stops between applying and recording, replay is safe.
        await query(sql);
        await query(
            `INSERT INTO schema_migrations (migration_name)
             VALUES ($1)
             ON CONFLICT (migration_name) DO NOTHING`,
            [migrationName],
        );
    }
}

module.exports = { ensureBaseSchema, ensureDatabaseSchema };
