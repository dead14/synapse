ALTER TABLE pipelines
    ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

ALTER TABLE alignment_sessions
    ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id),
    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

UPDATE alignment_sessions AS s
SET organization_id = p.organization_id
FROM pipelines AS p
WHERE s.organization_id IS NULL
  AND s.pipeline_id = p.id
  AND p.organization_id IS NOT NULL;

ALTER TABLE pipelines DROP CONSTRAINT IF EXISTS pipelines_name_key;
DROP INDEX IF EXISTS ix_pipelines_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pipelines_org_name
    ON pipelines (organization_id, lower(name))
    WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_pipelines_organization_id
    ON pipelines (organization_id);
CREATE INDEX IF NOT EXISTS ix_alignment_sessions_organization_id
    ON alignment_sessions (organization_id);
CREATE INDEX IF NOT EXISTS ix_alignment_sessions_created_by
    ON alignment_sessions (created_by);
