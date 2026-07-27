const crypto = require('node:crypto');

const JWT_ISSUER = 'synapse-api';
const JWT_AUDIENCE = 'synapse-web';
// 24 hours bounds how long a token can outlive the revocation checks that
// depend on it reaching the server (token_version / is_active are enforced
// per request, but a shorter lifetime still caps offline replay).
const DEFAULT_JWT_EXPIRES_IN = '24h';

function resolveJwtExpiresIn(env = process.env) {
    const configured = typeof env.JWT_EXPIRES_IN === 'string' ? env.JWT_EXPIRES_IN.trim() : '';
    return configured || DEFAULT_JWT_EXPIRES_IN;
}

const JWT_EXPIRES_IN = resolveJwtExpiresIn();

let cachedJwtSecret;
let warnedAboutEphemeralSecret = false;

function resolveJwtSecret(env = process.env, randomBytes = crypto.randomBytes) {
    const configuredSecret = env.JWT_SECRET?.trim();

    if (configuredSecret) {
        if (configuredSecret.length < 32) {
            throw new Error('JWT_SECRET must be at least 32 characters long');
        }
        return configuredSecret;
    }

    if (env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET is required in production');
    }

    return randomBytes(32).toString('hex');
}

function getJwtSecret() {
    if (!cachedJwtSecret) {
        cachedJwtSecret = resolveJwtSecret();
        if (!process.env.JWT_SECRET && !warnedAboutEphemeralSecret) {
            warnedAboutEphemeralSecret = true;
            console.warn(
                '[SECURITY] JWT_SECRET is not configured. Using an ephemeral development secret; sessions will be invalidated on restart.',
            );
        }
    }
    return cachedJwtSecret;
}

module.exports = {
    DEFAULT_JWT_EXPIRES_IN,
    JWT_AUDIENCE,
    JWT_EXPIRES_IN,
    JWT_ISSUER,
    getJwtSecret,
    resolveJwtExpiresIn,
    resolveJwtSecret,
};
