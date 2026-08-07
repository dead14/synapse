const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
    MAX_SNAPSHOT_BYTES,
    MAX_SNAPSHOT_ROWS,
    PUBLIC_SHARE_BODY_LIMIT,
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
    // Only the alignment and FFS results are publishable; the rest were removed
    // rather than left half-supported behind a link.
    for (const retired of ['GW_ALIGNMENT', 'SECTIONING', 'CORROSION']) {
        assert.throws(
            () => parseCreateShare({ kind: retired, title: 'x', snapshot: validSnapshot() }),
            /kind must be one of/i,
            `${retired} must not be publishable`,
        );
    }
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
            kind: 'FFS',
            title: 'x',
            snapshot: validSnapshot({ columns: [{ key: '__proto__', label: 'bad' }] }),
        }),
        /column key/i,
    );
    assert.throws(
        () => parseCreateShare({
            kind: 'ILI_ALIGNMENT',
            title: 'x',
            snapshot: validSnapshot({ rows: Array.from({ length: MAX_SNAPSHOT_ROWS + 1 }, () => ({})) }),
        }),
        /rows exceeds/i,
    );

    const oversizedText = 'x'.repeat(MAX_SNAPSHOT_BYTES);
    assert.throws(
        () => parseCreateShare({
            kind: 'FFS',
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
    assert.match(calls[3].text, /organization_id/i);
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
                source_ref: 'alignment-session:42',
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
    assert.equal(res.body.share.sourceRef, 'alignment-session:42');
    assert.deepEqual(res.body.share.snapshot, validSnapshot());
});

test('ILI share reads the canonical paged result with the scoped organization', async () => {
    const token = 'E'.repeat(43);
    const readCalls = [];
    const controller = createPublicShareController({
        repository: {
            findPublic: async () => ({
                public_id: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8',
                token_hash: hashShareToken(token),
                organization_id: 9,
                kind: 'ILI_ALIGNMENT',
                source_ref: 'alignment-session:42',
                created_at: new Date('2026-07-28T00:00:00.000Z'),
                expires_at: new Date('2026-08-27T00:00:00.000Z'),
                revoked_at: null,
            }),
        },
        readAlignmentPage: async (...args) => {
            readCalls.push(args);
            return { rows: [{ 'Source Key NEW': 'new:1' }], nextCursor: 20_000 };
        },
        now: () => new Date('2026-07-28T00:00:00.000Z'),
        pool: { name: 'pool' },
    });
    const res = fakeResponse();

    await controller.getPublicAlignmentResultsPage({
        params: { id: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8' },
        headers: { 'x-share-token': token },
        query: { limit: '20000', cursor: '0' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        items: [{ 'Source Key NEW': 'new:1' }],
        nextCursor: '20000',
    });
    assert.deepEqual(readCalls, [[
        { name: 'pool' },
        42,
        9,
        { limit: 20_000, after: 0 },
    ]]);
});

test('a link published from a run reads that run, not whichever run is newest', async () => {
    const token = 'F'.repeat(43);
    const sessionCalls = [];
    const jobCalls = [];
    const controller = createPublicShareController({
        repository: {
            findPublic: async () => ({
                public_id: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8',
                token_hash: hashShareToken(token),
                organization_id: 9,
                kind: 'ILI_ALIGNMENT',
                source_ref: 'alignment-job:align-77',
                created_at: new Date('2026-07-28T00:00:00.000Z'),
                expires_at: new Date('2026-08-27T00:00:00.000Z'),
                revoked_at: null,
            }),
        },
        readAlignmentPage: async (...args) => {
            sessionCalls.push(args);
            return { rows: [{ 'Source Key NEW': 'later-run' }], nextCursor: null };
        },
        readAlignmentJobPage: async (...args) => {
            jobCalls.push(args);
            return { rows: [{ 'Source Key NEW': 'published-run' }], nextCursor: null };
        },
        now: () => new Date('2026-07-28T00:00:00.000Z'),
        pool: { name: 'pool' },
    });
    const res = fakeResponse();

    await controller.getPublicAlignmentResultsPage({
        params: { id: 'f349577d-4bbf-4a99-8a46-6ee88cd84ea8' },
        headers: { 'x-share-token': token },
        query: { limit: '20000', cursor: '0' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items, [{ 'Source Key NEW': 'published-run' }]);
    assert.deepEqual(sessionCalls, []);
    assert.deepEqual(jobCalls, [[
        { name: 'pool' },
        'align-77',
        9,
        { limit: 20_000, after: 0 },
    ]]);
});

test('the published page state survives the contract instead of being dropped', () => {
    const parsed = parseCreateShare({
        kind: 'ILI_ALIGNMENT',
        title: 'Final alignment',
        sourceRef: 'alignment-job:align-77',
        snapshot: {
            version: 1,
            summary: [{ label: 'Matched', value: 42 }],
            notes: [],
            state: {
                kind: 'ILI_ALIGNMENT',
                interventions: [
                    { id: 'exclude-1', type: 'EXCLUDE_FEATURE', side: 'PAIR', sourceKey: 'old:7' },
                ],
                sections: [{ name: 'KP 0-5' }],
            },
        },
    });

    assert.deepEqual(parsed.snapshot.state, {
        kind: 'ILI_ALIGNMENT',
        interventions: [
            { id: 'exclude-1', type: 'EXCLUDE_FEATURE', side: 'PAIR', sourceKey: 'old:7' },
        ],
        sections: [{ name: 'KP 0-5' }],
    });
    assert.deepEqual(parsed.snapshot.columns, []);
    assert.deepEqual(parsed.snapshot.rows, []);
});

test('published state cannot smuggle prototype pollution or unbounded nesting', () => {
    const polluted = JSON.parse('{"kind":"FFS","results":[{"__proto__":{"admin":true},"key":"ffs:1"}]}');
    const parsed = parseCreateShare({
        kind: 'FFS',
        title: 'Assessment',
        snapshot: { version: 1, state: polluted },
    });
    assert.deepEqual(parsed.snapshot.state.results, [{ key: 'ffs:1' }]);

    let deep = { kind: 'FFS' };
    for (let level = 0; level < 40; level += 1) deep = { nested: deep };
    assert.throws(
        () => parseCreateShare({
            kind: 'FFS',
            title: 'Assessment',
            snapshot: { version: 1, state: deep },
        }),
        /nested deeper/i,
    );
});

test('the publish route accepts a body at least as large as the snapshot it must carry', () => {
    // A transport limit below the snapshot limit rejects the upload with a bare
    // 413 before the contract can say what was wrong, so the two are derived
    // from one number rather than written down twice.
    const megabytes = Number(PUBLIC_SHARE_BODY_LIMIT.replace('mb', ''));
    assert.ok(Number.isFinite(megabytes), 'the body limit is a parseable size');
    assert.ok(
        megabytes * 1024 * 1024 > MAX_SNAPSHOT_BYTES,
        `body limit ${PUBLIC_SHARE_BODY_LIMIT} must exceed the ${MAX_SNAPSHOT_BYTES} byte snapshot ceiling`,
    );
});
