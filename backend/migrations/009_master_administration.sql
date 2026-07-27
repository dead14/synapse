ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 25,
    ADD COLUMN IF NOT EXISTS max_pipelines INTEGER NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS password_reset_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_ip VARCHAR(64),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT password_reset_requests_status_check
        CHECK (status IN ('pending', 'resolved', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status
    ON password_reset_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user
    ON password_reset_requests (user_id, requested_at DESC);
