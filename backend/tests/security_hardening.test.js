const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveJwtSecret,
} = require('../src/config/auth');
const {
    AUTH_COOKIE_NAME,
    extractAuthToken,
    getAuthCookieOptions,
    signAuthToken,
    verifyAuthToken,
} = require('../src/middlewares/authMiddleware');
const {
    getAllowedOrigins,
    isOriginAllowed,
} = require('../src/config/security');
const {
    createRateLimiter,
} = require('../src/middlewares/rateLimit');
const {
    buildUserMutationScope,
    canAssignRole,
} = require('../src/modules/users/userAccess');
const {
    validateLoginInput,
    validateRegistrationInput,
} = require('../src/modules/auth/authValidation');
const {
    authenticateSocket,
    getSocketRooms,
} = require('../src/socket');
const {
    buildDatabaseConfig,
} = require('../src/config/databaseConfig');

test('production refuses to start without a strong JWT secret', () => {
    assert.throws(
        () => resolveJwtSecret({ NODE_ENV: 'production' }),
        /JWT_SECRET/,
    );
    assert.throws(
        () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'too-short' }),
        /at least 32 characters/,
    );
});

test('development uses an ephemeral JWT secret when none is configured', () => {
    const generated = resolveJwtSecret(
        { NODE_ENV: 'development' },
        () => Buffer.alloc(32, 7),
    );

    assert.equal(generated, Buffer.alloc(32, 7).toString('hex'));
    assert.notEqual(generated, 'synapse_secret_key_2026');
});

test('authentication accepts Bearer and httpOnly cookie tokens', () => {
    assert.equal(
        extractAuthToken({ headers: { authorization: 'Bearer api-token' } }),
        'api-token',
    );
    assert.equal(
        extractAuthToken({ headers: { cookie: `${AUTH_COOKIE_NAME}=cookie-token; theme=dark` } }),
        'cookie-token',
    );
});

test('session cookie is inaccessible to JavaScript and hardened for production', () => {
    assert.deepEqual(getAuthCookieOptions({ NODE_ENV: 'production' }), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 604800000,
    });
});

test('issued auth tokens are verified with the expected claims', () => {
    const token = signAuthToken({
        id: 41,
        orgId: 9,
        role: 'admin',
        username: 'operator',
        email: 'operator@example.test',
    });

    const decoded = verifyAuthToken(token);
    assert.equal(decoded.id, 41);
    assert.equal(decoded.orgId, 9);
    assert.equal(decoded.role, 'admin');
});

test('CORS allows configured browser origins and rejects unknown origins', () => {
    const origins = getAllowedOrigins({
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://synapse.example, https://admin.synapse.example ',
    });

    assert.equal(isOriginAllowed('https://synapse.example', origins), true);
    assert.equal(isOriginAllowed('https://attacker.example', origins), false);
    assert.equal(isOriginAllowed(undefined, origins), true);
});

test('production requires an explicit CORS allowlist', () => {
    assert.throws(
        () => getAllowedOrigins({ NODE_ENV: 'production' }),
        /ALLOWED_ORIGINS/,
    );
});

test('auth rate limiter blocks requests after the configured limit', () => {
    let now = 1_000;
    const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 2,
        now: () => now,
    });
    const req = { ip: '203.0.113.1', socket: {} };
    const statuses = [];
    const makeResponse = () => ({
        setHeader() {},
        status(code) {
            statuses.push(code);
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    });

    let nextCalls = 0;
    limiter(req, makeResponse(), () => { nextCalls += 1; });
    limiter(req, makeResponse(), () => { nextCalls += 1; });
    limiter(req, makeResponse(), () => { nextCalls += 1; });

    assert.equal(nextCalls, 2);
    assert.deepEqual(statuses, [429]);

    now += 60_001;
    limiter(req, makeResponse(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 3);
});

test('admin user mutations are scoped to their own organization', () => {
    assert.deepEqual(
        buildUserMutationScope({ id: 5, orgId: 11, role: 'admin' }, 99, 2),
        {
            clause: 'id = $2 AND organization_id = $3',
            values: [99, 11],
        },
    );
});

test('only super admins receive the explicit cross-organization mutation scope', () => {
    assert.deepEqual(
        buildUserMutationScope({ id: 1, role: 'super_admin' }, 99, 2),
        {
            clause: 'id = $2',
            values: [99],
        },
    );
    assert.equal(canAssignRole({ role: 'admin' }, 'super_admin'), false);
    assert.equal(canAssignRole({ role: 'super_admin' }, 'super_admin'), true);
});

test('registration validation normalizes identity fields and enforces a strong password', () => {
    assert.deepEqual(
        validateRegistrationInput({
            orgName: '  Example Integrity  ',
            username: '  Operator  ',
            email: ' OPERATOR@EXAMPLE.TEST ',
            password: 'correct horse battery staple',
        }),
        {
            ok: true,
            value: {
                orgName: 'Example Integrity',
                username: 'Operator',
                email: 'operator@example.test',
                password: 'correct horse battery staple',
            },
        },
    );

    assert.equal(
        validateRegistrationInput({
            orgName: 'Example',
            username: 'Operator',
            email: 'operator@example.test',
            password: 'short',
        }).error,
        'Password must be between 12 and 128 characters',
    );
});

test('login validation rejects malformed or unbounded credentials', () => {
    assert.equal(validateLoginInput({ email: 'not-an-email', password: 'password' }).ok, false);
    assert.equal(validateLoginInput({ email: 'a@example.test', password: 'x'.repeat(129) }).ok, false);
});

test('socket handshake is authenticated and rooms come only from signed identity', async () => {
    const token = signAuthToken({ id: 77, orgId: 13, role: 'admin' });
    const socket = {
        handshake: { auth: { token }, headers: {} },
    };

    await new Promise((resolve, reject) => {
        authenticateSocket(socket, (error) => error ? reject(error) : resolve());
    });

    assert.equal(socket.user.id, 77);
    assert.deepEqual(getSocketRooms(socket.user), ['user_77', 'org_13']);
});

test('socket handshake rejects an unauthenticated client', async () => {
    const error = await new Promise((resolve) => {
        authenticateSocket(
            { handshake: { auth: {}, headers: {} } },
            (authenticationError) => resolve(authenticationError),
        );
    });

    assert.equal(error.data.code, 'UNAUTHORIZED');
});

test('database configuration comes only from environment values', () => {
    assert.deepEqual(
        buildDatabaseConfig({ DATABASE_URL: 'postgresql://configured-host/synapse' }),
        { connectionString: 'postgresql://configured-host/synapse' },
    );

    assert.throws(
        () => buildDatabaseConfig({}),
        /DATABASE_URL.*DB_HOST.*DB_USER.*DB_PASSWORD.*DB_NAME/,
    );
});
