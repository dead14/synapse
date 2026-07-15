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
    console.log("DATABASE_URL in schema.js is:", process.env.DATABASE_URL);

    try {
        const tableCheck = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                  AND table_name = 'users'
            );
        `);
        if (tableCheck.rows[0].exists) {
            console.log("Database tables already initialized. Skipping Python init_db.");
            return;
        }
    } catch (err) {
        console.warn("Table check failed, proceeding with initialization:", err.message);
    }

    const initBaseSchema = dependencies.initBaseSchema || ensureBaseSchema;
    const readFile = dependencies.readFile || fs.readFile;

    await initBaseSchema();
    const migrationPath = path.join(__dirname, '../../migrations/001_tenant_ownership.sql');
    const sql = await readFile(migrationPath, 'utf8');
    await query(sql);
}

module.exports = { ensureBaseSchema, ensureDatabaseSchema };
