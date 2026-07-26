function createRateLimiter({
    windowMs = 15 * 60 * 1000,
    max = 10,
    maxEntries = 10_000,
    now = Date.now,
} = {}) {
    if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(max) || max <= 0) {
        throw new TypeError('Rate limiter windowMs and max must be positive numbers');
    }

    const attempts = new Map();

    function pruneExpired(currentTime) {
        for (const [key, entry] of attempts) {
            if (entry.resetAt <= currentTime) attempts.delete(key);
        }
    }

    return (req, res, next) => {
        const currentTime = now();
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        let entry = attempts.get(key);

        if (!entry || entry.resetAt <= currentTime) {
            if (attempts.size >= maxEntries) {
                pruneExpired(currentTime);
                if (attempts.size >= maxEntries) {
                    attempts.delete(attempts.keys().next().value);
                }
            }
            entry = { count: 0, resetAt: currentTime + windowMs };
            attempts.set(key, entry);
        }

        entry.count += 1;
        const remaining = Math.max(0, max - entry.count);
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000));

        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

        if (entry.count > max) {
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                error: 'Too many authentication attempts. Please try again later.',
            });
        }

        return next();
    };
}

module.exports = { createRateLimiter };
