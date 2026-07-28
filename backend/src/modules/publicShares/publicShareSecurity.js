const {
    createHash,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} = require('node:crypto');

const PUBLISHER_ROLES = new Set(['engineer', 'admin', 'super_admin']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function hashShareToken(accessToken) {
    return createHash('sha256').update(accessToken, 'utf8').digest('hex');
}

function createShareCredential() {
    const accessToken = randomBytes(32).toString('base64url');
    return {
        publicId: randomUUID(),
        accessToken,
        tokenHash: hashShareToken(accessToken),
    };
}

function verifyShareToken(accessToken, expectedHash) {
    if (typeof accessToken !== 'string' || !TOKEN_PATTERN.test(accessToken)) return false;
    if (typeof expectedHash !== 'string' || !HASH_PATTERN.test(expectedHash)) return false;
    const actual = Buffer.from(hashShareToken(accessToken), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function canPublishShare(principal) {
    return PUBLISHER_ROLES.has(principal?.role)
        && Number.isSafeInteger(Number(principal?.orgId))
        && Number(principal.orgId) > 0;
}

function requireSharePublisher(req, res, next) {
    if (canPublishShare(req.user)) return next();
    return res.status(403).json({
        error: {
            code: 'SHARE_PUBLISH_FORBIDDEN',
            message: 'Your role cannot publish results outside the organization.',
        },
    });
}

module.exports = {
    canPublishShare,
    createShareCredential,
    hashShareToken,
    requireSharePublisher,
    verifyShareToken,
};
