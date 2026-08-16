-- Risk-based inspection screenings become sessions of their own.
--
-- API 580 is direct about this: the assessment's inputs, assumptions and results
-- "shall be captured and maintained such that the assessment can be recreated or
-- updated at a later time by others who were not involved in the original
-- assessment", and it says outright that it is preferable to store that
-- information in a computerized database. Until now the RBI page held everything
-- in React state — four consequence dropdowns and a derived table — so nothing
-- survived a refresh and nothing could be reviewed by a second engineer.
--
-- `record_json` holds the whole entered screening: the line and what it carries,
-- the reviewed pipeline threat categories, the consequence classes with their
-- per-section overrides, and the sign-off. One document rather than a handful of
-- child tables, because it is authored, reviewed and superseded as one — the
-- same reasoning as `ffs_sessions`, and the same reason a half-saved screening
-- must never be readable.
--
-- The evidence behind the probability is deliberately NOT copied in. The
-- screening points at the FFS session it was derived from and re-reads it, so a
-- risk ranking can never quietly disagree with the fitness-for-service
-- assessment it cites. `summary_json` beside it is denormalised for the
-- register, which lists screenings without opening the document.
CREATE TABLE IF NOT EXISTS rbi_sessions (
    id                BIGSERIAL PRIMARY KEY,
    organization_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- The filed FFS assessment the measured likelihood is read from. Nullable
    -- because that assessment may later be deleted; the RBI then still opens,
    -- and says on its face that its evidence has gone.
    ffs_session_id    BIGINT REFERENCES ffs_sessions(id) ON DELETE SET NULL,
    pipeline_id       INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
    label             TEXT NOT NULL,
    -- 'draft' while it is being authored, 'issued' once it has been signed off.
    -- Issue is a state change an auditor can see, not a flag on a form field.
    status            TEXT NOT NULL DEFAULT 'draft',
    -- Which step the author stopped on, so re-opening resumes where they left.
    current_step      TEXT,
    summary_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    record_json       JSONB NOT NULL,
    created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rbi_sessions_status_check CHECK (status IN ('draft', 'issued'))
);

-- The register lists an organization's screenings newest-worked-on first, so
-- that is the lookup that has to be cheap.
CREATE INDEX IF NOT EXISTS ix_rbi_sessions_organization
    ON rbi_sessions (organization_id, updated_at DESC);

-- A screening is meant to be re-run when new inspection results land. Finding
-- the screenings that cite a given FFS session is what makes that answerable.
CREATE INDEX IF NOT EXISTS ix_rbi_sessions_ffs_session
    ON rbi_sessions (ffs_session_id, updated_at DESC);
