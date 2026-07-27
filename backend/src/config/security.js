const DEFAULT_DEVELOPMENT_ORIGINS = Object.freeze([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);

function getAllowedOrigins(env = process.env) {
    const configuredOrigins = env.ALLOWED_ORIGINS
        ?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (configuredOrigins?.includes('*')) {
        throw new Error('ALLOWED_ORIGINS cannot contain * when credentials are enabled');
    }

    if (configuredOrigins?.length) {
        return configuredOrigins;
    }

    if (env.NODE_ENV === 'production') {
        throw new Error('ALLOWED_ORIGINS is required in production');
    }

    return [...DEFAULT_DEVELOPMENT_ORIGINS];
}

function isOriginAllowed(origin, allowedOrigins) {
    // Requests without an Origin header are non-browser/server-to-server calls.
    return !origin || allowedOrigins.includes(origin);
}

// Express accepts a hop count, booleans, and preset/CIDR strings ('loopback',
// '10.0.0.0/8', comma lists) for 'trust proxy'.  Accepting only /^\d+$/ meant
// TRUST_PROXY=true was silently ignored, req.ip stayed the proxy address for
// every client, and the login rate limiter became a global lockout.
function resolveTrustProxy(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return undefined;
    if (/^\d+$/.test(raw)) return Number(raw);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
}

function createCorsOptions(env = process.env) {
    const allowedOrigins = getAllowedOrigins(env);
    return {
        origin(origin, callback) {
            callback(null, isOriginAllowed(origin, allowedOrigins));
        },
        credentials: true,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 600,
    };
}

function securityHeaders(req, res, next) {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
}

module.exports = {
    DEFAULT_DEVELOPMENT_ORIGINS,
    createCorsOptions,
    getAllowedOrigins,
    isOriginAllowed,
    resolveTrustProxy,
    securityHeaders,
};
