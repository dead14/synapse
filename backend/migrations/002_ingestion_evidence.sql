ALTER TABLE survey_runs
    ADD COLUMN IF NOT EXISTS source_sha256 VARCHAR(64),
    ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS parser_version VARCHAR(64),
    ADD COLUMN IF NOT EXISTS schema_version VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ingestion_audit JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_survey_runs_pipeline_source_sha256
    ON survey_runs (pipeline_id, source_sha256)
    WHERE source_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_survey_runs_uploaded_by
    ON survey_runs (uploaded_by);

CREATE INDEX IF NOT EXISTS ix_survey_runs_pipeline_uploaded_at
    ON survey_runs (pipeline_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS ix_ili_features_run_distance
    ON ili_features (run_id, log_distance_m);

CREATE INDEX IF NOT EXISTS ix_alignment_sessions_old_run
    ON alignment_sessions (run_old_id);

CREATE INDEX IF NOT EXISTS ix_alignment_sessions_new_run
    ON alignment_sessions (run_new_id);
