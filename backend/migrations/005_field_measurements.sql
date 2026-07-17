BEGIN;

CREATE TABLE IF NOT EXISTS field_measurements (
    id BIGSERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    integrity_case_id BIGINT NOT NULL REFERENCES integrity_cases(id) ON DELETE CASCADE,
    survey_run_id INTEGER REFERENCES survey_runs(id) ON DELETE SET NULL,
    ili_feature_id INTEGER REFERENCES ili_features(id) ON DELETE SET NULL,
    measurement_type VARCHAR(24) NOT NULL CHECK (measurement_type IN ('NDE','EXCAVATION','UT','ILI_VALIDATION')),
    observed_at DATE NOT NULL,
    chainage_m DOUBLE PRECISION CHECK (chainage_m IS NULL OR chainage_m >= 0),
    depth_pct DOUBLE PRECISION CHECK (depth_pct IS NULL OR (depth_pct >= 0 AND depth_pct <= 100)),
    depth_mm DOUBLE PRECISION CHECK (depth_mm IS NULL OR depth_mm >= 0),
    depth_uncertainty_pct DOUBLE PRECISION CHECK (depth_uncertainty_pct IS NULL OR (depth_uncertainty_pct >= 0 AND depth_uncertainty_pct <= 100)),
    length_mm DOUBLE PRECISION CHECK (length_mm IS NULL OR length_mm >= 0),
    width_mm DOUBLE PRECISION CHECK (width_mm IS NULL OR width_mm >= 0),
    source_reference TEXT NOT NULL,
    source_row INTEGER CHECK (source_row IS NULL OR source_row > 0),
    status VARCHAR(24) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewed','accepted','rejected','superseded')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    CONSTRAINT ck_field_measurements_value CHECK (depth_pct IS NOT NULL OR depth_mm IS NOT NULL),
    CONSTRAINT ck_field_measurements_feature_run CHECK (ili_feature_id IS NULL OR survey_run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_field_measurements_org_case_id
    ON field_measurements (organization_id, integrity_case_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_field_measurements_feature
    ON field_measurements (ili_feature_id, observed_at DESC)
    WHERE ili_feature_id IS NOT NULL;

COMMIT;
