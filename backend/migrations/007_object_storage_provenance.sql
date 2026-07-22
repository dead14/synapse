ALTER TABLE survey_runs
    ADD COLUMN IF NOT EXISTS source_object_key TEXT;

CREATE INDEX IF NOT EXISTS ix_survey_runs_source_object_key
    ON survey_runs (source_object_key)
    WHERE source_object_key IS NOT NULL;
