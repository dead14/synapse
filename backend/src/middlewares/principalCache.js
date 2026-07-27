// Per-process cache of the session-critical user columns (is_active, role,
// token_version) that the HTTP auth middleware and the socket handshake
// re-check after JWT signature verification.
//
// STALENESS BOUND: a revocation (deactivation, demotion, token_version bump)
// is enforced immediately on the process that performed it — the mutating
// code paths call invalidate()/bumpTokenVersion() — and within
// AUTH_PRINCIPAL_CACHE_TTL_MS (default 30 seconds) on every other process.
// That bound is the price of keeping hot request paths at zero additional
// database queries; set the TTL to 0 to re-check on every request.

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 10_000;

// Single primary-key lookup; the id comes from a signed token, so no
// organization filter is needed (mirrors how /api/auth/me loads the user).
const PRINCIPAL_QUERY = `
    SELECT COALESCE(is_active, true) AS is_active,
           role,
           COALESCE(token_version, 0) AS token_version
    FROM users
    WHERE id = $1
`;

function resolvePrincipalCacheTtlMs(env = process.env) {
    const configured = Number(env.AUTH_PRINCIPAL_CACHE_TTL_MS);
    return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_TTL_MS;
}

// Tokens signed before the claim existed carry no `tv`; they count as
// version 0, so they stay valid exactly until the user's first bump.
function tokenVersionFromClaims(claims) {
    const version = Number(claims?.tv);
    return Number.isInteger(version) && version >= 0 ? version : 0;
}

function createPrincipalCache({
    query,
    ttlMs,
    now = Date.now,
    maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) {
    if (typeof query !== 'function') {
        throw new TypeError('createPrincipalCache requires a query function');
    }

    const entries = new Map();

    function evictOldest() {
        let oldestKey;
        let oldestFetchedAt = Infinity;
        for (const [key, entry] of entries) {
            if (entry.fetchedAt < oldestFetchedAt) {
                oldestFetchedAt = entry.fetchedAt;
                oldestKey = key;
            }
        }
        if (oldestKey !== undefined) entries.delete(oldestKey);
    }

    async function load(userId) {
        const currentTime = now();
        const ttl = ttlMs !== undefined ? ttlMs : resolvePrincipalCacheTtlMs();
        const cached = entries.get(userId);
        if (cached && currentTime - cached.fetchedAt < ttl) {
            return cached.value;
        }

        let row;
        try {
            const result = await query(PRINCIPAL_QUERY, [userId]);
            row = result.rows[0];
        } catch (error) {
            // A database blip must not instantly kill every active session:
            // serve the last known state when we have one, otherwise let the
            // caller fail closed.
            if (cached) return cached.value;
            throw error;
        }

        const value = row
            ? {
                exists: true,
                isActive: row.is_active !== false,
                role: typeof row.role === 'string' && row.role ? row.role : null,
                tokenVersion: Number(row.token_version) || 0,
            }
            : { exists: false, isActive: false, role: null, tokenVersion: 0 };

        // Delete-then-set keeps Map iteration ordered by refresh recency, and
        // the explicit oldest-timestamp eviction bounds memory even so.
        entries.delete(userId);
        if (entries.size >= maxEntries) evictOldest();
        entries.set(userId, { value, fetchedAt: currentTime });
        return value;
    }

    return {
        load,
        invalidate(userId) { entries.delete(userId); },
        clear() { entries.clear(); },
        get size() { return entries.size; },
    };
}

// Default instance shared by the HTTP middleware and the socket handshake.
// The pg pool is required lazily so auth modules stay importable without a
// configured database (tests inject their own cache or query function).
let pool;
function poolQuery(text, values) {
    if (!pool) pool = require('../config/db');
    return pool.query(text, values);
}

const defaultPrincipalCache = createPrincipalCache({ query: poolQuery });

function invalidatePrincipal(userId) {
    defaultPrincipalCache.invalidate(Number(userId));
}

// Revoke every outstanding token of a user.  Runs against the supplied query
// function (pool, client, or transaction) and drops the local cache entry so
// the mutating process enforces the bump immediately; other processes
// converge within the cache TTL.
async function bumpTokenVersion(query, userId, cache = defaultPrincipalCache) {
    await query(
        'UPDATE users SET token_version = COALESCE(token_version, 0) + 1, updated_at = NOW() WHERE id = $1',
        [userId],
    );
    cache.invalidate(userId);
}

module.exports = {
    DEFAULT_TTL_MS,
    bumpTokenVersion,
    createPrincipalCache,
    defaultPrincipalCache,
    invalidatePrincipal,
    resolvePrincipalCacheTtlMs,
    tokenVersionFromClaims,
};
