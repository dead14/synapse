BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    job_id TEXT PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    pipeline_name VARCHAR(120) NOT NULL,
    survey_year INTEGER NOT NULL,
    vendor VARCHAR(120) NOT NULL,
    source_file TEXT NOT NULL,
    object_key TEXT NOT NULL,
    source_sha256 VARCHAR(64),
    state VARCHAR(24) NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    run_id INTEGER REFERENCES survey_runs(id) ON DELETE SET NULL,
    result_json JSONB,
    error_code VARCHAR(80),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_ingestion_jobs_org_created
    ON ingestion_jobs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ingestion_jobs_state_created
    ON ingestion_jobs (state, created_at ASC);

CREATE TABLE IF NOT EXISTS alignment_jobs (
    job_id TEXT PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES alignment_sessions(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    state VARCHAR(24) NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    result_json JSONB,
    error_code VARCHAR(80),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_alignment_jobs_org_created
    ON alignment_jobs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alignment_jobs_session
    ON alignment_jobs (session_id, created_at DESC);

COMMIT;
