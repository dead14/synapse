-- Risk-based inspection assessments become sessions of their own.
--
-- API 580 4th edition §16.2 is unusually direct about this: the assessment's
-- inputs, assumptions, team, and results "shall be captured and maintained such
-- that the assessment can be recreated or updated at a later time by others who
-- were not involved in the original assessment", and it says outright that it is
-- preferable to store that information in a computerized database. Until now the
-- RBI page held everything in React state — four consequence dropdowns and a
-- derived table — so nothing survived a refresh, nothing could be reviewed by a
-- second engineer, and none of the §6-§16 record the practice asks for existed
-- at all. An RBI assessment is a controlled document, so it gets a row.
--
-- `record_json` holds the whole authored document: planning and boundaries (§6),
-- team (§7), data collection and validation (§8), the damage mechanism review
-- and its IOWs (§9), inspection effectiveness (§10), consequence inputs (§11),
-- risk criteria and the assumptions register (§12), the inspection and
-- mitigation plan (§13/§14), reassessment triggers (§15), and sign-off (§16).
-- It is one document rather than a dozen child tables because it is authored,
-- reviewed, and superseded as one — the same reasoning as `ffs_sessions`, and
-- the same reason a half-saved assessment must never be readable.
--
-- The evidence behind the likelihood is deliberately NOT copied in. The RBI
-- points at the FFS session it was derived from and re-reads it, so a risk
-- ranking can never quietly disagree with the fitness-for-service assessment it
-- cites. `summary_json` beside it is denormalised for the registry, which lists
-- assessments without opening the document.
CREATE TABLE IF NOT EXISTS rbi_sessions (
    id                BIGSERIAL PRIMARY KEY,
    organization_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- The filed FFS assessment the measured likelihood is read from. Nullable
    -- because that assessment may later be deleted; the RBI then still opens,
    -- and says on its face that its evidence has gone.
    ffs_session_id    BIGINT REFERENCES ffs_sessions(id) ON DELETE SET NULL,
    pipeline_id       INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
    label             TEXT NOT NULL,
    -- 'draft' while it is being authored, 'issued' once it has been signed off
    -- under §16.5. Issue is a state change an auditor can see, not a flag on a
    -- form field.
    status            TEXT NOT NULL DEFAULT 'draft',
    -- Which wizard step the author stopped on, so re-opening resumes rather than
    -- restarting a ten-step document.
    current_step      TEXT,
    summary_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    record_json       JSONB NOT NULL,
    created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rbi_sessions_status_check CHECK (status IN ('draft', 'issued'))
);

-- The registry lists an organization's assessments newest-worked-on first, so
-- that is the lookup that has to be cheap.
CREATE INDEX IF NOT EXISTS ix_rbi_sessions_organization
    ON rbi_sessions (organization_id, updated_at DESC);

-- §15.2.2 asks for a reassessment when new inspection results land. Finding the
-- RBI assessments that cite a given FFS session is what makes that answerable.
CREATE INDEX IF NOT EXISTS ix_rbi_sessions_ffs_session
    ON rbi_sessions (ffs_session_id, updated_at DESC);
