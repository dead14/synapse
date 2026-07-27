const jwt = require('jsonwebtoken');
const {
    JWT_AUDIENCE,
    JWT_EXPIRES_IN,
    JWT_ISSUER,
    getJwtSecret,
} = require('../config/auth');
const {
    defaultPrincipalCache,
    tokenVersionFromClaims,
} = require('./principalCache');

const AUTH_COOKIE_NAME = 'synapse_session';
const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookieHeader(cookieHeader = '') {
    return cookieHeader.split(';').reduce((cookies, part) => {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex < 1) return cookies;

        const name = part.slice(0, separatorIndex).trim();
        const rawValue = part.slice(separatorIndex + 1).trim();
        try {
            cookies[name] = decodeURIComponent(rawValue);
        } catch {
            cookies[name] = rawValue;
        }
        return cookies;
    }, {});
}

function extractAuthToken(requestLike = {}) {
    const headers = requestLike.headers || {};
    const authorization = headers.authorization || headers.Authorization;
    if (typeof authorization === 'string') {
        const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
        if (match) return match[1];
    }

    if (typeof requestLike.auth?.token === 'string' && requestLike.auth.token.trim()) {
        return requestLike.auth.token.trim();
    }

    return parseCookieHeader(headers.cookie)[AUTH_COOKIE_NAME] || null;
}

function signAuthToken(payload) {
    return jwt.sign(payload, getJwtSecret(), {
        audience: JWT_AUDIENCE,
        expiresIn: JWT_EXPIRES_IN,
        issuer: JWT_ISSUER,
    });
}

function verifyAuthToken(token) {
    const decoded = jwt.verify(token, getJwtSecret(), {
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
    });

    const hasValidIdentity = Number.isInteger(Number(decoded.id)) && typeof decoded.role === 'string';
    const hasTenant = decoded.role === 'super_admin' || Number.isInteger(Number(decoded.orgId));
    if (!hasValidIdentity || !hasTenant) {
        throw new jwt.JsonWebTokenError('Token payload is invalid');
    }

    return decoded;
}

function getAuthCookieOptions(env = process.env) {
    return {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
    };
}

function setAuthCookie(res, token) {
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
}

function clearAuthCookie(res) {
    const { maxAge, ...options } = getAuthCookieOptions();
    res.clearCookie(AUTH_COOKIE_NAME, options);
}

// Signature verification alone cannot revoke a session, so after the JWT
// checks out the middleware re-reads the user's is_active / token_version /
// role through the principal cache (one indexed SELECT, cached for at most
// AUTH_PRINCIPAL_CACHE_TTL_MS — see principalCache.js for the staleness
// bound).  The database role wins over the token claim so demotions apply
// before the token expires.
function createAuthMiddleware({ principalCache = defaultPrincipalCache } = {}) {
    return async function authMiddleware(req, res, next) {
        const token = extractAuthToken(req);
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        let decoded;
        try {
            decoded = verifyAuthToken(token);
        } catch {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        let principal;
        try {
            principal = await principalCache.load(Number(decoded.id));
        } catch (error) {
            // No cached state to fall back on (principalCache serves stale
            // entries through database blips): fail closed.
            console.error('Auth principal lookup failed:', error.message);
            return res.status(503).json({ error: 'Authentication is temporarily unavailable' });
        }

        if (!principal.exists || !principal.isActive
            || principal.tokenVersion !== tokenVersionFromClaims(decoded)) {
            return res.status(401).json({ error: 'Session is no longer valid' });
        }

        req.user = { ...decoded, role: principal.role || decoded.role }; // { id, orgId, role, username, email }
        return next();
    };
}

const authMiddleware = createAuthMiddleware();

function requireAdmin(req, res, next) {
    if (req.user && ['admin', 'super_admin'].includes(req.user.role)) {
        return next();
    } else {
        return res.status(403).json({ error: 'Requires admin privileges' });
    }
}

function requireSuperAdmin(req, res, next) {
    if (req.user?.role === 'super_admin') return next();
    return res.status(403).json({ error: 'Requires master admin privileges' });
}

module.exports = {
    AUTH_COOKIE_NAME,
    authMiddleware,
    clearAuthCookie,
    createAuthMiddleware,
    extractAuthToken,
    getAuthCookieOptions,
    parseCookieHeader,
    requireAdmin,
    requireSuperAdmin,
    setAuthCookie,
    signAuthToken,
    verifyAuthToken,
};
