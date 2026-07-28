const defaultPool = require('../../config/db');
const { writeAuditLog: defaultWriteAuditLog } = require('../audit/auditLog');
const { parseCreateShare, parseShareFilters } = require('./publicShareContract');
const defaultRepository = require('./publicShareRepository');
const {
    canPublishShare,
    createShareCredential,
    verifyShareToken,
} = require('./publicShareSecurity');

const PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function errorEnvelope(code, message) {
    return { error: { code, message } };
}

function publicUnavailable(res) {
    return res.status(404).json(errorEnvelope(
        'SHARE_UNAVAILABLE',
        'This shared result is unavailable.',
    ));
}

function metadata(row) {
    return {
        id: row.public_id,
        kind: row.kind,
        title: row.title,
        sourceRef: row.source_ref || null,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at || null,
        isActive: !row.revoked_at && new Date(row.expires_at).getTime() > Date.now(),
    };
}

function createPublicShareController({
    pool = defaultPool,
    repository = {
        create: defaultRepository.createPublicShare,
        findPublic: defaultRepository.findPublicShare,
        listOwned: defaultRepository.listOwnedShares,
        revokeOwned: defaultRepository.revokeOwnedShare,
    },
    credentialFactory = createShareCredential,
    now = () => new Date(),
    writeAuditLog = defaultWriteAuditLog,
} = {}) {
    return {
        async create(req, res) {
            if (!canPublishShare(req.user)) {
                return res.status(403).json(errorEnvelope(
                    'SHARE_PUBLISH_FORBIDDEN',
                    'Your role cannot publish results outside the organization.',
                ));
            }

            let payload;
            try {
                payload = parseCreateShare(req.body);
            } catch (error) {
                return res.status(400).json(errorEnvelope('INVALID_PUBLIC_SHARE', error.message));
            }

            const credential = credentialFactory();
            const createdAt = now();
            const expiresAt = new Date(createdAt.getTime() + payload.expiresInDays * DAY_MS);
            try {
                const row = await repository.create(pool, {
                    publicId: credential.publicId,
                    tokenHash: credential.tokenHash,
                    organizationId: Number(req.user.orgId),
                    createdBy: Number(req.user.id) || null,
                    kind: payload.kind,
                    title: payload.title,
                    sourceRef: payload.sourceRef,
                    snapshot: payload.snapshot,
                    expiresAt,
                });
                if (!row) throw new Error('Share was not persisted');

                await writeAuditLog({
                    userId: Number(req.user.id) || null,
                    organizationId: Number(req.user.orgId),
                    action: 'public_share_created',
                    target: `public-share:${row.public_id}; kind=${row.kind}`,
                    ipAddress: req.ip || null,
                });
                return res.status(201).json({
                    share: {
                        ...metadata(row),
                        accessToken: credential.accessToken,
                    },
                });
            } catch (error) {
                console.error('Create public share error:', error.message);
                return res.status(500).json(errorEnvelope(
                    'PUBLIC_SHARE_CREATE_FAILED',
                    'Failed to create the public link.',
                ));
            }
        },

        async list(req, res) {
            if (!canPublishShare(req.user)) {
                return res.status(403).json(errorEnvelope(
                    'SHARE_PUBLISH_FORBIDDEN',
                    'Your role cannot manage public links.',
                ));
            }
            let filters;
            try {
                filters = parseShareFilters(req.query);
            } catch (error) {
                return res.status(400).json(errorEnvelope('INVALID_PUBLIC_SHARE_FILTER', error.message));
            }
            try {
                const rows = await repository.listOwned(pool, Number(req.user.orgId), filters);
                const currentTime = now().getTime();
                return res.json({
                    shares: rows.map((row) => ({
                        id: row.public_id,
                        kind: row.kind,
                        title: row.title,
                        sourceRef: row.source_ref || null,
                        createdAt: row.created_at,
                        expiresAt: row.expires_at,
                        revokedAt: row.revoked_at || null,
                        isActive: !row.revoked_at
                            && new Date(row.expires_at).getTime() > currentTime,
                    })),
                });
            } catch (error) {
                console.error('List public shares error:', error.message);
                return res.status(500).json(errorEnvelope(
                    'PUBLIC_SHARE_LIST_FAILED',
                    'Failed to load public links.',
                ));
            }
        },

        async revoke(req, res) {
            if (!canPublishShare(req.user)) {
                return res.status(403).json(errorEnvelope(
                    'SHARE_PUBLISH_FORBIDDEN',
                    'Your role cannot manage public links.',
                ));
            }
            if (!PUBLIC_ID_PATTERN.test(req.params.id || '')) {
                return res.status(400).json(errorEnvelope('INVALID_PUBLIC_SHARE_ID', 'Invalid public link ID.'));
            }
            try {
                const row = await repository.revokeOwned(
                    pool,
                    req.params.id,
                    Number(req.user.orgId),
                );
                if (!row) {
                    return res.status(404).json(errorEnvelope(
                        'PUBLIC_SHARE_NOT_FOUND',
                        'Public link not found.',
                    ));
                }
                await writeAuditLog({
                    userId: Number(req.user.id) || null,
                    organizationId: Number(req.user.orgId),
                    action: 'public_share_revoked',
                    target: `public-share:${row.public_id}`,
                    ipAddress: req.ip || null,
                });
                return res.status(204).send();
            } catch (error) {
                console.error('Revoke public share error:', error.message);
                return res.status(500).json(errorEnvelope(
                    'PUBLIC_SHARE_REVOKE_FAILED',
                    'Failed to revoke the public link.',
                ));
            }
        },

        async getPublic(req, res) {
            const publicId = req.params.id || '';
            const accessToken = req.headers['x-share-token'];
            if (!PUBLIC_ID_PATTERN.test(publicId) || typeof accessToken !== 'string') {
                return publicUnavailable(res);
            }
            try {
                const row = await repository.findPublic(pool, publicId);
                const unavailable = !row
                    || row.revoked_at
                    || new Date(row.expires_at).getTime() <= now().getTime()
                    || !verifyShareToken(accessToken, row.token_hash);
                if (unavailable) return publicUnavailable(res);

                res.setHeader('Cache-Control', 'private, no-store');
                res.setHeader('Referrer-Policy', 'no-referrer');
                return res.json({
                    share: {
                        id: row.public_id,
                        kind: row.kind,
                        title: row.title,
                        createdAt: row.created_at,
                        expiresAt: row.expires_at,
                        snapshot: row.snapshot_json,
                    },
                });
            } catch (error) {
                console.error('Get public share error:', error.message);
                return publicUnavailable(res);
            }
        },
    };
}

const controller = createPublicShareController();

module.exports = {
    createPublicShareController,
    ...controller,
};
