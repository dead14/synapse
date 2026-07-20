BEGIN;

CREATE TABLE IF NOT EXISTS direct_assessment_projects (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    method VARCHAR(16) NOT NULL CHECK (method IN ('ECDA','ICDA','SCCDA','CDA')),
    phase VARCHAR(32) NOT NULL DEFAULT 'pre-assessment'
        CHECK (phase IN ('pre-assessment','indirect-inspection','direct-examination','post-assessment','reassessment')),
    selection_basis TEXT NOT NULL,
    reassessment_due_at TIMESTAMPTZ,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cp_surveys (
    id BIGSERIAL PRIMARY KEY,
    direct_assessment_id BIGINT NOT NULL REFERENCES direct_assessment_projects(id) ON DELETE CASCADE,
    survey_type VARCHAR(16) NOT NULL CHECK (survey_type IN ('CIPS','DCVG','ACVG','PCM','SOIL')),
    survey_date DATE NOT NULL,
    source_reference TEXT NOT NULL,
    reading_count INTEGER NOT NULL DEFAULT 0 CHECK (reading_count >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS field_packages (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    integrity_case_id BIGINT REFERENCES integrity_cases(id) ON DELETE CASCADE,
    package_key TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    sync_status VARCHAR(24) NOT NULL DEFAULT 'ready'
        CHECK (sync_status IN ('ready','downloaded','upload_required','conflict','synchronized','closed')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, package_key)
);

CREATE INDEX IF NOT EXISTS ix_da_projects_org_phase ON direct_assessment_projects (organization_id, phase, id DESC);
CREATE INDEX IF NOT EXISTS ix_cp_surveys_da_date ON cp_surveys (direct_assessment_id, survey_date DESC);
CREATE INDEX IF NOT EXISTS ix_field_packages_org_sync ON field_packages (organization_id, sync_status, id DESC);

COMMIT;
