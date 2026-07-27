-- Session revocation: every issued JWT embeds the user's token_version at
-- sign time (the `tv` claim).  Auth re-checks the column after signature
-- verification, so bumping it invalidates every outstanding token for that
-- user (logout, deactivation, credential rotation) without waiting for the
-- JWT to expire.  Existing rows start at 0, matching tokens issued before
-- the claim existed.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
