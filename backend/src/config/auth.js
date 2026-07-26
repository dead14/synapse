const crypto = require('node:crypto');

const JWT_ISSUER = 'synapse-api';
const JWT_AUDIENCE = 'synapse-web';
const JWT_EXPIRES_IN = '7d';

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
    JWT_AUDIENCE,
    JWT_EXPIRES_IN,
    JWT_ISSUER,
    getJwtSecret,
    resolveJwtSecret,
};
