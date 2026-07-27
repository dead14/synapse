-- Corrosion Analysis review: which alignment features an engineer released to FFS.
-- A row exists only for a feature that was reviewed; absence means "not selected".
CREATE TABLE IF NOT EXISTS ffs_candidates (
    id               BIGSERIAL PRIMARY KEY,
    session_id       INTEGER NOT NULL REFERENCES alignment_sessions(id) ON DELETE CASCADE,
    organization_id  INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    source_key_new   TEXT NOT NULL,
    feature_id       TEXT,
    selected         BOOLEAN NOT NULL DEFAULT FALSE,
    reason           TEXT,
    -- Alignment config fingerprint the review was made against. A re-run with a
    -- different configuration invalidates the selection instead of silently
    -- carrying it onto a superseded result.
    result_signature TEXT NOT NULL,
    reviewed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, source_key_new)
);

CREATE INDEX IF NOT EXISTS ix_ffs_candidates_session_selected
    ON ffs_candidates (session_id, selected);
CREATE INDEX IF NOT EXISTS ix_ffs_candidates_organization
    ON ffs_candidates (organization_id);
