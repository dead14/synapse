CREATE TABLE IF NOT EXISTS integrity_cases (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE CASCADE,
    anomaly_key TEXT NOT NULL,
    title TEXT NOT NULL,
    stage VARCHAR(32) NOT NULL DEFAULT 'import',
    response_category VARCHAR(32),
    data_quality_confidence DOUBLE PRECISION,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ,
    method_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_integrity_case_stage CHECK (
        stage IN ('import','validate','align','assess','decide','repair','verify')
    ),
    CONSTRAINT ck_integrity_case_response CHECK (
        response_category IS NULL OR response_category IN ('immediate','scheduled','monitor','engineering_review')
    ),
    CONSTRAINT ck_integrity_case_confidence CHECK (
        data_quality_confidence IS NULL OR
        (data_quality_confidence >= 0 AND data_quality_confidence <= 1)
    ),
    UNIQUE (organization_id, anomaly_key)
);

CREATE TABLE IF NOT EXISTS integrity_approvals (
    id BIGSERIAL PRIMARY KEY,
    integrity_case_id BIGINT NOT NULL REFERENCES integrity_cases(id) ON DELETE CASCADE,
    decision VARCHAR(16) NOT NULL CHECK (decision IN ('approved','rejected')),
    reason TEXT NOT NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repair_plans (
    id BIGSERIAL PRIMARY KEY,
    integrity_case_id BIGINT NOT NULL REFERENCES integrity_cases(id) ON DELETE CASCADE,
    repair_method TEXT NOT NULL,
    engineering_basis TEXT NOT NULL,
    dig_sheet JSONB NOT NULL DEFAULT '{}'::jsonb,
    work_order_reference TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_repair_plan_status CHECK (
        status IN ('draft','submitted','approved','excavating','repaired','verified','closed')
    )
);

CREATE TABLE IF NOT EXISTS integrity_evidence (
    id BIGSERIAL PRIMARY KEY,
    integrity_case_id BIGINT NOT NULL REFERENCES integrity_cases(id) ON DELETE CASCADE,
    repair_plan_id BIGINT REFERENCES repair_plans(id) ON DELETE CASCADE,
    evidence_type VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'required',
    source_reference TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    CONSTRAINT ck_integrity_evidence_status CHECK (
        status IN ('required','requested','submitted','reviewed','accepted','rejected','superseded')
    )
);

CREATE TABLE IF NOT EXISTS compliance_requirements (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    edition TEXT NOT NULL,
    category VARCHAR(32) NOT NULL,
    requirement_text TEXT NOT NULL,
    source_reference TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (organization_id, code, edition)
);

CREATE TABLE IF NOT EXISTS compliance_evidence_links (
    id BIGSERIAL PRIMARY KEY,
    requirement_id BIGINT NOT NULL REFERENCES compliance_requirements(id) ON DELETE CASCADE,
    integrity_case_id BIGINT REFERENCES integrity_cases(id) ON DELETE CASCADE,
    evidence_id BIGINT REFERENCES integrity_evidence(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'gap',
    review_note TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    CONSTRAINT ck_compliance_link_status CHECK (
        status IN ('not_applicable','gap','requested','submitted','accepted','rejected')
    )
);

CREATE INDEX IF NOT EXISTS ix_integrity_cases_org_stage
    ON integrity_cases (organization_id, stage, id DESC);
CREATE INDEX IF NOT EXISTS ix_integrity_cases_pipeline
    ON integrity_cases (pipeline_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_integrity_approvals_case
    ON integrity_approvals (integrity_case_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_repair_plans_case
    ON repair_plans (integrity_case_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_integrity_evidence_case_status
    ON integrity_evidence (integrity_case_id, status, id DESC);
CREATE INDEX IF NOT EXISTS ix_compliance_requirements_org
    ON compliance_requirements (organization_id, category, active);
