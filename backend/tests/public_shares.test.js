const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
    MAX_SNAPSHOT_BYTES,
    MAX_SNAPSHOT_ROWS,
    parseCreateShare,
    parseShareFilters,
} = require('../src/modules/publicShares/publicShareContract');
const {
    canPublishShare,
    createShareCredential,
    hashShareToken,
    verifyShareToken,
} = require('../src/modules/publicShares/publicShareSecurity');
const {
    createPublicShare,
    findPublicShare,
    listOwnedShares,
    revokeOwnedShare,
} = require('../src/modules/publicShares/publicShareRepository');
const {
    createPublicShareController,
} = require('../src/modules/publicShares/publicShareController');

function validSnapshot(overrides = {}) {
    return {
        version: 1,
        summary: [{ label: 'Matched', value: 42 }],
        columns: [{ key: 'sourceKey', label: 'Source key' }],
        rows: [{ sourceKey: 'NEW:42' }],
        notes: ['Decision support only'],
        ...overrides,
    };
}

function fakeResponse() {
    return {
        body: undefined,
        headers: {},
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
        send(value) { this.body = value; return this; },
        setHeader(name, value) { this.headers[name] = value; },
    };
}

test('create contract normalizes supported snapshots and applies safe defaults', () => {
    const parsed = parseCreateShare({
        kind: 'ili_alignment',
        title: '  Final alignment KP 12-24  ',
        sourceRef: ' alignment-session:42 ',
        snapshot: validSnapshot(),
    });

    assert.equal(parsed.kind, 'ILI_ALIGNMENT');
    assert.equal(parsed.title, 'Final alignment KP 12-24');
    assert.equal(parsed.sourceRef, 'alignment-session:42');
    assert.equal(parsed.expiresInDays, 30);
    assert.deepEqual(parsed.snapshot, validSnapshot());
});

test('create contract rejects unknown kinds, unsafe expiry, and malformed display data', () => {
    assert.throws(
        () => parseCreateShare({ kind: 'PDF', title: 'x', snapshot: validSnapshot() }),
        /kind must be one of/i,
    );
    assert.throws(
        () => parseCreateShare({
            kind: 'FFS',
            title: 'x',
            expiresInDays: 365,
            snapshot: validSnapshot(),
        }),
        /expiresInDays must be one of/i,
    );
    assert.throws(
        () => parseCreateShare({
            kind: 'CORROSION',
            title: 'x',
            snapshot: validSnapshot({ columns: [{ key: '__proto__', label: 'bad' }] }),
        }),
        /column key/i,
    );
    assert.throws(
        () => parseCreateShare({
            kind: 'SECTIONING',
            title: 'x',
            snapshot: validSnapshot({ rows: Array.from({ length: MAX_SNAPSHOT_ROWS + 1 }, () => ({})) }),
        }),
        /rows exceeds/i,
    );

    const oversizedText = 'x'.repeat(MAX_SNAPSHOT_BYTES);
    assert.throws(
        () => parseCreateShare({
            kind: 'GW_ALIGNMENT',
            title: 'x',
            snapshot: validSnapshot({
                columns: [{ key: 'blob', label: 'Blob' }],
                rows: [{ blob: oversizedText }],
            }),
        }),
        /snapshot exceeds/i,
    );
});

test('list filters are bounded and validated', () => {
    assert.deepEqual(parseShareFilters({}), { kind: null, sourceRef: null });
    assert.deepEqual(
        parseShareFilters({ kind: 'ffs', sourceRef: ' session:9 ' }),
        { kind: 'FFS', sourceRef: 'session:9' },
    );
    assert.throws(() => parseShareFilters({ kind: 'unknown' }), /kind must be one of/i);
});

test('share credentials are high-entropy, digest-only, and compared safely', () => {
    const credential = createShareCredential();

    assert.match(credential.publicId, /^[0-9a-f-]{36}$/i);
    assert.match(credential.accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(credential.tokenHash.length, 64);
    assert.equal(credential.tokenHash, hashShareToken(credential.accessToken));
    assert.equal(verifyShareToken(credential.accessToken, credential.tokenHash), true);
    const replacement = credential.accessToken.endsWith('A') ? 'B' : 'A';
    assert.equal(
        verifyShareToken(`${credential.accessToken.slice(0, -1)}${replacement}`, credential.tokenHash),
        false,
    );
    assert.equal(verifyShareToken('not-a-valid-token', credential.tokenHash), false);
});

test('only organization-scoped engineering roles can publish', () => {
    assert.equal(canPublishShare({ role: 'engineer', orgId: 4 }), true);
    assert.equal(canPublishShare({ role: 'admin', orgId: 4 }), true);
    assert.equal(canPublishShare({ role: 'super_admin', orgId: 4 }), true);
    assert.equal(canPublishShare({ role: 'viewer', orgId: 4 }), false);
    assert.equal(canPublishShare({ role: 'user', orgId: 4 }), false);
    assert.equal(canPublishShare({ role: 'super_admin' }), false);
});

test('repository owner operations are tenant scoped and never select token plaintext', async () => {
    const calls = [];
    const pool = {
        async query(text, values) {
            calls.push({ text, values });
            return { rows: [], rowCount: 0 };
        },
    };

    await createPublicShare(pool, {
        publicId: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8',
        tokenHash: 'a'.repeat(64),
        organizationId: 9,
        createdBy: 7,
        kind: 'ILI_ALIGNMENT',
        title: 'Final',
        sourceRef: 'session:42',
        snapshot: validSnapshot(),
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    });
    await listOwnedShares(pool, 9, { kind: 'ILI_ALIGNMENT', sourceRef: 'session:42' });
    await revokeOwnedShare(pool, 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8', 9);
    await findPublicShare(pool, 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8');

    assert.match(calls[0].text, /token_hash/);
    assert.doesNotMatch(calls[0].text, /access_token/i);
    assert.match(calls[1].text, /organization_id = \$1/i);
    assert.deepEqual(calls[1].values, [9, 'ILI_ALIGNMENT', 'session:42']);
    assert.match(calls[2].text, /organization_id = \$2/i);
    assert.doesNotMatch(calls[3].text, /organization_id/i);
    assert.doesNotMatch(calls[3].text, /created_by/i);
});

test('controller returns the secret once and writes only its digest', async () => {
    const captured = [];
    const token = 'A'.repeat(43);
    const controller = createPublicShareController({
        repository: {
            async create(_pool, input) {
                captured.push(input);
                return {
                    public_id: input.publicId,
                    kind: input.kind,
                    title: input.title,
                    source_ref: input.sourceRef,
                    created_at: new Date('2026-07-28T00:00:00.000Z'),
                    expires_at: input.expiresAt,
                    revoked_at: null,
                };
            },
        },
        credentialFactory: () => ({
            publicId: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8',
            accessToken: token,
            tokenHash: hashShareToken(token),
        }),
        now: () => new Date('2026-07-28T00:00:00.000Z'),
        pool: {},
        writeAuditLog: async () => {},
    });
    const req = {
        body: {
            kind: 'FFS',
            title: 'FFS result',
            expiresInDays: 7,
            snapshot: validSnapshot(),
        },
        ip: '203.0.113.7',
        user: { id: 7, orgId: 9, role: 'engineer' },
    };
    const res = fakeResponse();

    await controller.create(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.share.accessToken, token);
    assert.equal(captured[0].tokenHash, hashShareToken(token));
    assert.equal(captured[0].accessToken, undefined);
    assert.equal(captured[0].expiresAt.toISOString(), '2026-08-04T00:00:00.000Z');
});

test('public controller uses one generic unavailable response for bad, revoked, and expired links', async () => {
    const token = 'B'.repeat(43);
    const scenarios = [
        null,
        {
            token_hash: hashShareToken('C'.repeat(43)),
            expires_at: new Date('2026-08-01T00:00:00.000Z'),
            revoked_at: null,
        },
        {
            token_hash: hashShareToken(token),
            expires_at: new Date('2026-08-01T00:00:00.000Z'),
            revoked_at: new Date('2026-07-27T00:00:00.000Z'),
        },
        {
            token_hash: hashShareToken(token),
            expires_at: new Date('2026-07-27T00:00:00.000Z'),
            revoked_at: null,
        },
    ];

    for (const row of scenarios) {
        const controller = createPublicShareController({
            repository: { findPublic: async () => row },
            now: () => new Date('2026-07-28T00:00:00.000Z'),
            pool: {},
        });
        const req = {
            params: { id: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8' },
            headers: { 'x-share-token': token },
        };
        const res = fakeResponse();

        await controller.getPublic(req, res);

        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, {
            error: {
                code: 'SHARE_UNAVAILABLE',
                message: 'This shared result is unavailable.',
            },
        });
    }
});

test('public controller exposes only display fields and disables caching/referrers', async () => {
    const token = 'D'.repeat(43);
    const controller = createPublicShareController({
        repository: {
            findPublic: async () => ({
                public_id: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8',
                token_hash: hashShareToken(token),
                kind: 'CORROSION',
                title: 'Corrosion review',
                snapshot_json: validSnapshot(),
                created_at: new Date('2026-07-28T00:00:00.000Z'),
                expires_at: new Date('2026-08-27T00:00:00.000Z'),
                revoked_at: null,
                organization_id: 9,
                created_by: 7,
            }),
        },
        now: () => new Date('2026-07-28T00:00:00.000Z'),
        pool: {},
    });
    const res = fakeResponse();

    await controller.getPublic({
        params: { id: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8' },
        headers: { 'x-share-token': token },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
    assert.equal(res.body.share.organizationId, undefined);
    assert.equal(res.body.share.createdBy, undefined);
    assert.equal(res.body.share.tokenHash, undefined);
    assert.deepEqual(res.body.share.snapshot, validSnapshot());
});
