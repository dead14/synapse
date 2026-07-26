const test = require('node:test');
const assert = require('node:assert/strict');

// The controllers under test require the pg pool at module load; the pool
// never connects because every test mocks pool.query / pool.connect.
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const {
    bumpTokenVersion,
    createPrincipalCache,
    tokenVersionFromClaims,
} = require('../src/middlewares/principalCache');
const {
    AUTH_COOKIE_NAME,
    createAuthMiddleware,
    signAuthToken,
    verifyAuthToken,
} = require('../src/middlewares/authMiddleware');
const { createSocketAuthenticator } = require('../src/socket');
const authController = require('../src/modules/auth/authController');
const userController = require('../src/modules/users/userController');

function principalRow({ isActive = true, role = 'admin', tokenVersion = 0 } = {}) {
    return { rows: [{ is_active: isActive, role, token_version: tokenVersion }] };
}

function fakeResponse() {
    return {
        statusCode: null,
        body: null,
        headers: {},
        cookies: [],
        cleared: [],
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        setHeader(name, value) { this.headers[name] = value; },
        cookie(name, value, options) { this.cookies.push({ name, value, options }); },
        clearCookie(name, options) { this.cleared.push({ name, options }); },
    };
}

function bearerRequest(token) {
    return { headers: { authorization: `Bearer ${token}` } };
}

test('token version claims default to zero and reject garbage', () => {
    assert.equal(tokenVersionFromClaims({}), 0);
    assert.equal(tokenVersionFromClaims(undefined), 0);
    assert.equal(tokenVersionFromClaims({ tv: 3 }), 3);
    assert.equal(tokenVersionFromClaims({ tv: '4' }), 4);
    assert.equal(tokenVersionFromClaims({ tv: 'many' }), 0);
    assert.equal(tokenVersionFromClaims({ tv: -1 }), 0);
});

test('a token minted before a token_version bump is rejected with 401', async () => {
    const middleware = createAuthMiddleware({
        principalCache: createPrincipalCache({
            query: async () => principalRow({ tokenVersion: 1 }),
            ttlMs: 0,
        }),
    });

    const staleResponse = fakeResponse();
    let nextCalls = 0;
    await middleware(
        bearerRequest(signAuthToken({ id: 7, orgId: 3, role: 'admin' })), // legacy token, tv=0
        staleResponse,
        () => { nextCalls += 1; },
    );
    assert.equal(staleResponse.statusCode, 401);
    assert.deepEqual(staleResponse.body, { error: 'Session is no longer valid' });
    assert.equal(nextCalls, 0);

    const freshResponse = fakeResponse();
    const request = bearerRequest(signAuthToken({ id: 7, orgId: 3, role: 'admin', tv: 1 }));
    await middleware(request, freshResponse, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(request.user.id, 7);
});

test('deactivating a user revokes an outstanding session (TTL 0)', async () => {
    let active = true;
    const middleware = createAuthMiddleware({
        principalCache: createPrincipalCache({
            query: async () => principalRow({ isActive: active }),
            ttlMs: 0,
        }),
    });
    const token = signAuthToken({ id: 8, orgId: 3, role: 'engineer', tv: 0 });

    let nextCalls = 0;
    await middleware(bearerRequest(token), fakeResponse(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);

    active = false;
    const rejected = fakeResponse();
    await middleware(bearerRequest(token), rejected, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(rejected.statusCode, 401);
});

test('unknown or deleted users are rejected', async () => {
    const middleware = createAuthMiddleware({
        principalCache: createPrincipalCache({ query: async () => ({ rows: [] }), ttlMs: 0 }),
    });
    const response = fakeResponse();
    await middleware(
        bearerRequest(signAuthToken({ id: 404, orgId: 1, role: 'admin' })),
        response,
        () => { throw new Error('must not pass'); },
    );
    assert.equal(response.statusCode, 401);
});

test('the database role overrides the token role claim', async () => {
    const middleware = createAuthMiddleware({
        principalCache: createPrincipalCache({
            query: async () => principalRow({ role: 'viewer' }),
            ttlMs: 0,
        }),
    });
    const request = bearerRequest(signAuthToken({ id: 9, orgId: 3, role: 'admin', tv: 0 }));
    await middleware(request, fakeResponse(), () => {});
    assert.equal(request.user.role, 'viewer');
});

test('principal lookups are cached within the TTL and refresh after it', async () => {
    let queries = 0;
    let currentTime = 0;
    const cache = createPrincipalCache({
        query: async () => { queries += 1; return principalRow(); },
        ttlMs: 30_000,
        now: () => currentTime,
    });

    await cache.load(1);
    await cache.load(1);
    assert.equal(queries, 1, 'second load within the TTL must hit the cache');

    currentTime = 30_000;
    await cache.load(1);
    assert.equal(queries, 2, 'a load after the TTL must re-query');

    cache.invalidate(1);
    await cache.load(1);
    assert.equal(queries, 3, 'invalidate must force the next load to re-query');
});

test('a database blip serves the last known principal, otherwise fails closed', async () => {
    let failing = false;
    let currentTime = 0;
    const cache = createPrincipalCache({
        query: async () => {
            if (failing) throw new Error('database down');
            return principalRow();
        },
        ttlMs: 1_000,
        now: () => currentTime,
    });

    await cache.load(5);
    failing = true;
    currentTime = 60_000; // entry is stale, refresh fails -> stale is served
    assert.equal((await cache.load(5)).isActive, true);

    // No cached state for this user: the middleware must fail closed.
    const middleware = createAuthMiddleware({ principalCache: cache });
    const response = fakeResponse();
    await middleware(
        bearerRequest(signAuthToken({ id: 6, orgId: 1, role: 'admin' })),
        response,
        () => { throw new Error('must not pass'); },
    );
    assert.equal(response.statusCode, 503);
});

test('the principal cache evicts its oldest entry at capacity', async () => {
    let currentTime = 0;
    const cache = createPrincipalCache({
        query: async () => principalRow(),
        ttlMs: 60_000,
        now: () => currentTime,
        maxEntries: 2,
    });

    await cache.load(1);
    currentTime = 10;
    await cache.load(2);
    currentTime = 20;
    await cache.load(3);
    assert.equal(cache.size, 2, 'capacity must hold');
});

test('bumpTokenVersion increments the counter and invalidates the cache entry', async () => {
    let cacheQueries = 0;
    const cache = createPrincipalCache({
        query: async () => { cacheQueries += 1; return principalRow(); },
        ttlMs: 60_000,
        now: () => 0,
    });
    await cache.load(9);
    assert.equal(cacheQueries, 1);

    const executed = [];
    await bumpTokenVersion(
        async (text, values) => { executed.push({ text, values }); return { rowCount: 1 }; },
        9,
        cache,
    );
    assert.match(executed[0].text, /token_version = COALESCE\(token_version, 0\) \+ 1/);
    assert.deepEqual(executed[0].values, [9]);

    await cache.load(9);
    assert.equal(cacheQueries, 2, 'the bump must drop the cached entry');
});

test('logout bumps the caller token_version and clears the cookie', async (t) => {
    const queries = [];
    t.mock.method(pool, 'query', async (text, values) => {
        queries.push({ text: String(text), values });
        return { rows: [], rowCount: 1 };
    });

    const token = signAuthToken({ id: 21, orgId: 4, role: 'admin', tv: 2 });
    const response = fakeResponse();
    await authController.logout(
        { headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` }, ip: '127.0.0.1' },
        response,
    );

    const bump = queries.find((entry) => entry.text.includes('token_version'));
    assert.ok(bump, 'logout with a valid token must bump token_version');
    assert.deepEqual(bump.values, [21]);
    assert.equal(response.cleared[0].name, AUTH_COOKIE_NAME);
    assert.deepEqual(response.body, { message: 'Logged out' });
});

test('logout without a usable token still succeeds and issues no bump', async (t) => {
    const queries = [];
    t.mock.method(pool, 'query', async (text, values) => {
        queries.push({ text: String(text), values });
        return { rows: [], rowCount: 0 };
    });

    const response = fakeResponse();
    await authController.logout({ headers: {} }, response);

    assert.equal(queries.length, 0);
    assert.equal(response.cleared[0].name, AUTH_COOKIE_NAME);
    assert.deepEqual(response.body, { message: 'Logged out' });
});

test('login embeds the current token_version in the issued token', async (t) => {
    const passwordHash = await bcrypt.hash('password123', 4);
    t.mock.method(pool, 'query', async (text) => {
        if (String(text).includes('FROM users')) {
            return {
                rows: [{
                    id: 31,
                    username: 'operator',
                    email: 'operator@example.test',
                    password_hash: passwordHash,
                    role: 'engineer',
                    organization_id: 6,
                    org_name: 'Example',
                    token_version: 5,
                }],
            };
        }
        return { rows: [], rowCount: 1 }; // activity log insert
    });

    const response = fakeResponse();
    await authController.login(
        { body: { email: 'operator@example.test', password: 'password123' }, ip: '::1' },
        response,
    );

    const issued = response.cookies.find((cookie) => cookie.name === AUTH_COOKIE_NAME);
    assert.ok(issued, 'login must set the session cookie');
    const decoded = verifyAuthToken(issued.value);
    assert.equal(decoded.tv, 5);
    assert.equal(decoded.id, 31);
});

test('registration issues a token bound to token_version 0', async (t) => {
    const clientQueries = [];
    t.mock.method(pool, 'connect', async () => ({
        query: async (text) => {
            clientQueries.push(String(text));
            if (String(text).includes('SELECT id FROM users')) return { rows: [] };
            if (String(text).includes('INSERT INTO organizations')) return { rows: [{ id: 51 }] };
            if (String(text).includes('INSERT INTO users')) {
                return {
                    rows: [{
                        id: 52,
                        username: 'founder',
                        email: 'founder@example.test',
                        role: 'admin',
                        token_version: 0,
                    }],
                };
            }
            return { rows: [] }; // BEGIN / COMMIT
        },
        release() {},
    }));
    t.mock.method(pool, 'query', async () => ({ rows: [], rowCount: 1 })); // activity log

    const response = fakeResponse();
    await authController.register(
        {
            body: {
                orgName: 'Example Integrity',
                username: 'founder',
                email: 'founder@example.test',
                password: 'correct horse battery staple',
            },
            ip: '127.0.0.1',
        },
        response,
    );

    assert.equal(response.statusCode, 201);
    assert.ok(clientQueries.some((text) => text.includes('token_version')));
    const issued = response.cookies.find((cookie) => cookie.name === AUTH_COOKIE_NAME);
    assert.equal(verifyAuthToken(issued.value).tv, 0);
});

test('toggle-status bumps token_version so live sessions die with the account', async (t) => {
    const queries = [];
    t.mock.method(pool, 'query', async (text, values) => {
        queries.push({ text: String(text), values });
        return { rows: [{ id: 12 }], rowCount: 1 };
    });

    const response = fakeResponse();
    await userController.toggleStatus(
        { params: { id: '12' }, body: { is_active: false }, user: { id: 1, orgId: 2, role: 'admin' } },
        response,
    );

    assert.match(queries[0].text, /token_version = COALESCE\(token_version, 0\) \+ 1/);
    assert.deepEqual(queries[0].values, [false, 12, 2]);
    assert.deepEqual(response.body, { message: 'User status updated' });
});

test('password reset bumps token_version so old sessions cannot continue', async (t) => {
    const queries = [];
    t.mock.method(pool, 'query', async (text, values) => {
        queries.push({ text: String(text), values });
        return { rows: [{ id: 12 }], rowCount: 1 };
    });

    const response = fakeResponse();
    await userController.resetPassword(
        { params: { id: '12' }, body: { newPassword: 'brand-new-secret' }, user: { id: 1, orgId: 2, role: 'admin' } },
        response,
    );

    assert.match(queries[0].text, /token_version = COALESCE\(token_version, 0\) \+ 1/);
    assert.deepEqual(response.body, { message: 'Password reset successful' });
});

test('socket handshake rejects a revoked session and adopts the database role', async () => {
    const authenticate = createSocketAuthenticator({
        principalCache: createPrincipalCache({
            query: async () => principalRow({ tokenVersion: 4, role: 'viewer' }),
            ttlMs: 0,
        }),
    });

    const staleToken = signAuthToken({ id: 8, orgId: 2, role: 'admin', tv: 3 });
    const error = await new Promise((resolve) => {
        authenticate({ handshake: { auth: { token: staleToken }, headers: {} } }, resolve);
    });
    assert.equal(error.data.code, 'UNAUTHORIZED');

    const liveToken = signAuthToken({ id: 8, orgId: 2, role: 'admin', tv: 4 });
    const socket = { handshake: { auth: { token: liveToken }, headers: {} } };
    await new Promise((resolve, reject) => {
        authenticate(socket, (authError) => (authError ? reject(authError) : resolve()));
    });
    assert.equal(socket.user.role, 'viewer');
});

test('socket handshake rejects a deactivated user', async () => {
    const authenticate = createSocketAuthenticator({
        principalCache: createPrincipalCache({
            query: async () => principalRow({ isActive: false }),
            ttlMs: 0,
        }),
    });
    const token = signAuthToken({ id: 15, orgId: 2, role: 'engineer', tv: 0 });
    const error = await new Promise((resolve) => {
        authenticate({ handshake: { auth: { token }, headers: {} } }, resolve);
    });
    assert.equal(error.data.code, 'UNAUTHORIZED');
});
