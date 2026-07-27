// Redis-backed fixed-window rate limiter (INCR + PEXPIRE on keys that embed
// the window index, so rollover happens by key change).  All key dimensions
// of one limiter share a single pipeline — one Redis roundtrip per request.
// A route carrying both the global /api limiter and a strict per-route
// limiter pays two roundtrips; accepted so the two limiters stay independent
// middlewares instead of sharing state through the request.
//
// FAIL-OPEN: when Redis is unreachable the request is allowed (optionally
// through a supplied in-process fallback limiter) and the outage is logged at
// most once per interval.  Rate limiting is a budget, not an authorization
// boundary, so it must never take the API down with it.

const { extractAuthToken, verifyAuthToken } = require('./authMiddleware');

function integerFromEnv(name, fallback, env = process.env) {
    const parsed = Number(env[name]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Key for authenticated traffic.  Route-level limiters run after
// authMiddleware and reuse req.user; the app-level limiter runs before it,
// so it verifies the token itself (an HMAC check costs microseconds — the
// signature has not been checked yet at that point in the chain).  Anonymous
// or invalid tokens yield null: such requests are skipped here and rejected
// by the route's own auth middleware instead.
function authenticatedUserKey(req) {
    const authenticatedId = req.user?.id;
    if (authenticatedId !== undefined && authenticatedId !== null) {
        return `user:${authenticatedId}`;
    }
    const token = extractAuthToken(req);
    if (!token) return null;
    try {
        return `user:${verifyAuthToken(token).id}`;
    } catch {
        return null;
    }
}

// Keys for the anonymous auth endpoints: the caller's network address and
// the targeted account, both checked against the same budget.  One address
// cannot spray many accounts past its own limit, and one account cannot be
// brute-forced from many addresses past the account's limit.
function authRequestKeys(req) {
    const keys = [`ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`];
    const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    if (email && email.length <= 254) {
        keys.push(`email:${email}`);
    }
    return keys;
}

function createRedisRateLimiter({
    prefix,
    windowMs,
    max,
    keyGenerator,
    redis,
    fallback,
    now = Date.now,
    logger = console,
    failureLogIntervalMs = 60_000,
} = {}) {
    if (!prefix || typeof keyGenerator !== 'function') {
        throw new TypeError('createRedisRateLimiter requires a prefix and a keyGenerator');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(max) || max <= 0) {
        throw new TypeError('Rate limiter windowMs and max must be positive numbers');
    }

    // `redis` may be a client, a factory, or omitted — the shared limiter
    // connection is then required lazily on first use, so importing this
    // module never opens a connection (tests inject fakes).
    const resolveClient = typeof redis === 'function'
        ? redis
        : redis
            ? () => redis
            : () => require('../config/redis').getRateLimiterConnection();

    let lastFailureLogAt = -Infinity;

    function allowWithoutRedis(req, res, next, error) {
        const currentTime = now();
        if (currentTime - lastFailureLogAt >= failureLogIntervalMs) {
            lastFailureLogAt = currentTime;
            logger.error(`Rate limiter "${prefix}" degraded (allowing requests): ${error.message}`);
        }
        if (fallback) return fallback(req, res, next);
        return next();
    }

    return async function redisRateLimiter(req, res, next) {
        const generated = keyGenerator(req);
        const keys = (Array.isArray(generated) ? generated : [generated]).filter(Boolean);
        if (keys.length === 0) return next();

        const currentTime = now();
        const windowIndex = Math.floor(currentTime / windowMs);
        const windowEndsAt = (windowIndex + 1) * windowMs;

        let counts;
        try {
            const pipeline = resolveClient().pipeline();
            for (const key of keys) {
                const redisKey = `${prefix}:${key}:${windowIndex}`;
                pipeline.incr(redisKey);
                // Slightly beyond the window so no counter key can leak
                // forever if a PEXPIRE is lost; the window index in the key
                // performs the actual rollover.
                pipeline.pexpire(redisKey, windowMs + 5_000);
            }
            const results = await pipeline.exec();
            if (!Array.isArray(results)) {
                throw new Error('Redis pipeline returned no results');
            }
            counts = keys.map((_, index) => {
                const [commandError, value] = results[index * 2] || [];
                if (commandError) throw commandError;
                return Number(value);
            });
        } catch (error) {
            return allowWithoutRedis(req, res, next, error);
        }

        const used = Math.max(...counts);
        const retryAfterSeconds = Math.max(1, Math.ceil((windowEndsAt - currentTime) / 1000));

        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, max - used)));
        res.setHeader('RateLimit-Reset', String(Math.ceil(windowEndsAt / 1000)));

        if (used > max) {
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({ error: 'RATE_LIMITED', retryAfterSeconds });
        }
        return next();
    };
}

module.exports = {
    authRequestKeys,
    authenticatedUserKey,
    createRedisRateLimiter,
    integerFromEnv,
};
