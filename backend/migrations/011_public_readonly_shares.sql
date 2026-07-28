-- Immutable, expiring capability links for read-only result snapshots.
-- The bearer secret is never stored: only its SHA-256 digest is persisted.
CREATE TABLE IF NOT EXISTS public_result_shares (
    public_id       UUID PRIMARY KEY,
    token_hash      CHAR(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL CHECK (
        kind IN ('GW_ALIGNMENT', 'SECTIONING', 'ILI_ALIGNMENT', 'CORROSION', 'FFS')
    ),
    title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    source_ref      TEXT CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
    snapshot_json   JSONB NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS ix_public_result_shares_owner_created
    ON public_result_shares (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_public_result_shares_active_expiry
    ON public_result_shares (expires_at)
    WHERE revoked_at IS NULL;
