async function createPublicShare(pool, input) {
    const result = await pool.query(
        `INSERT INTO public_result_shares
            (public_id, token_hash, organization_id, created_by, kind, title,
             source_ref, snapshot_json, expires_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING public_id, kind, title, source_ref, created_at, expires_at, revoked_at`,
        [
            input.publicId,
            input.tokenHash,
            input.organizationId,
            input.createdBy,
            input.kind,
            input.title,
            input.sourceRef,
            JSON.stringify(input.snapshot),
            input.expiresAt,
        ],
    );
    return result.rows[0] || null;
}

async function listOwnedShares(pool, organizationId, filters) {
    const values = [organizationId];
    const clauses = ['organization_id = $1'];
    if (filters.kind) {
        values.push(filters.kind);
        clauses.push(`kind = $${values.length}`);
    }
    if (filters.sourceRef) {
        values.push(filters.sourceRef);
        clauses.push(`source_ref = $${values.length}`);
    }
    const result = await pool.query(
        `SELECT public_id, kind, title, source_ref, created_at, expires_at, revoked_at
         FROM public_result_shares
         WHERE ${clauses.join('\n           AND ')}
         ORDER BY created_at DESC
         LIMIT 100`,
        values,
    );
    return result.rows;
}

async function revokeOwnedShare(pool, publicId, organizationId) {
    const result = await pool.query(
        `UPDATE public_result_shares
         SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE public_id = $1::uuid
           AND organization_id = $2
         RETURNING public_id, revoked_at`,
        [publicId, organizationId],
    );
    return result.rows[0] || null;
}

// The columns needed to decide whether a link may be read at all.  Kept apart
// from the snapshot because the two are wanted at very different rates: the
// snapshot is read once, when the page opens, while these are re-checked on
// every request the page then makes.
const SHARE_ACCESS_COLUMNS = `public_id, token_hash, organization_id, kind, title, source_ref,
                created_at, expires_at, revoked_at`;

async function findPublicShare(pool, publicId) {
    const result = await pool.query(
        `SELECT ${SHARE_ACCESS_COLUMNS}, snapshot_json
         FROM public_result_shares
         WHERE public_id = $1::uuid`,
        [publicId],
    );
    return result.rows[0] || null;
}

/**
 * The same row without its frozen snapshot.
 *
 * An alignment link pages its rows in, and every one of those requests has to
 * re-verify the token — which meant re-reading, de-TOASTing and JSON-parsing
 * the whole stored snapshot once per page just to throw it away. Reading a
 * shared alignment therefore paid for its snapshot as many times as it had
 * pages. The paging path uses this projection; only the endpoint that actually
 * returns the snapshot reads the column.
 */
async function findPublicShareAccess(pool, publicId) {
    const result = await pool.query(
        `SELECT ${SHARE_ACCESS_COLUMNS}
         FROM public_result_shares
         WHERE public_id = $1::uuid`,
        [publicId],
    );
    return result.rows[0] || null;
}

module.exports = {
    createPublicShare,
    findPublicShare,
    findPublicShareAccess,
    listOwnedShares,
    revokeOwnedShare,
};
