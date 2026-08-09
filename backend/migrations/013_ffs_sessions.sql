-- FFS assessments become sessions of their own.
--
-- Until now an assessment existed only in the browser's navigation state: the
-- setup page computed it, handed it to the results page, and a refresh threw it
-- away. Nothing in the registry could link to it and nothing could re-open it,
-- so the only durable trace of an FFS run was the Excel file the engineer
-- happened to download. An assessment is evidence, so it gets a row.
--
-- `state_json` holds the same published-case document the public-share path
-- already builds (results, config, screening, alignment provenance), so a stored
-- session and a shared link revive through exactly one code path. The summary
-- columns beside it are denormalised for the registry, which lists sessions
-- without reading the case.
CREATE TABLE IF NOT EXISTS ffs_sessions (
    id                   BIGSERIAL PRIMARY KEY,
    organization_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- The alignment session the features were released from. Null for an
    -- assessment run off a manually uploaded sheet, which has no session.
    alignment_session_id INTEGER REFERENCES alignment_sessions(id) ON DELETE SET NULL,
    pipeline_id          INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
    label                TEXT NOT NULL,
    method               TEXT,
    feature_count        INTEGER NOT NULL DEFAULT 0,
    -- Counts the registry shows without opening the case.
    summary_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
    state_json           JSONB NOT NULL,
    created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_ffs_sessions_organization
    ON ffs_sessions (organization_id, created_at DESC);

-- The registry joins a survey run to its newest assessment through the
-- alignment session, so that lookup is the one that has to be cheap.
CREATE INDEX IF NOT EXISTS ix_ffs_sessions_alignment_session
    ON ffs_sessions (alignment_session_id, created_at DESC);
