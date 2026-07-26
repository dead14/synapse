const test = require('node:test');
const assert = require('node:assert/strict');

const {
    authRequestKeys,
    authenticatedUserKey,
    createRedisRateLimiter,
    integerFromEnv,
} = require('../src/middlewares/redisRateLimit');
const { createRateLimiter } = require('../src/middlewares/rateLimit');
const { signAuthToken } = require('../src/middlewares/authMiddleware');

// Minimal ioredis stand-in: supports the exact pipeline surface the limiter
// uses (incr + pexpire + exec) and a switchable failure mode.
class FakeRedis {
    constructor() {
        this.counters = new Map();
        this.failing = false;
    }

    pipeline() {
        const operations = [];
        const self = this;
        return {
            incr(key) { operations.push(['incr', key]); return this; },
            pexpire(key, ttlMs) { operations.push(['pexpire', key, ttlMs]); return this; },
            async exec() {
                if (self.failing) throw new Error('redis unavailable');
                return operations.map(([command, key]) => {
                    if (command === 'incr') {
                        const next = (self.counters.get(key) || 0) + 1;
                        self.counters.set(key, next);
                        return [null, next];
                    }
                    return [null, 1];
                });
            },
        };
    }
}

function fakeResponse() {
    return {
        statusCode: null,
        body: null,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        setHeader(name, value) { this.headers[name] = value; },
    };
}

async function invoke(limiter, req) {
    const response = fakeResponse();
    let allowed = false;
    await limiter(req, response, () => { allowed = true; });
    return { allowed, response };
}

test('redis limiter enforces the window budget and rolls over', async () => {
    let currentTime = 90_000; // inside window [60000, 120000)
    const limiter = createRedisRateLimiter({
        prefix: 'rl:test',
        windowMs: 60_000,
        max: 2,
        keyGenerator: (req) => `user:${req.userId}`,
        redis: new FakeRedis(),
        now: () => currentTime,
    });

    const first = await invoke(limiter, { userId: 1 });
    const second = await invoke(limiter, { userId: 1 });
    const third = await invoke(limiter, { userId: 1 });

    assert.equal(first.allowed, true);
    assert.equal(first.response.headers['RateLimit-Remaining'], '1');
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
    assert.equal(third.response.statusCode, 429);
    assert.deepEqual(third.response.body, { error: 'RATE_LIMITED', retryAfterSeconds: 30 });
    assert.equal(third.response.headers['Retry-After'], '30');
    assert.equal(third.response.headers['RateLimit-Limit'], '2');

    currentTime = 120_000; // next window
    const fourth = await invoke(limiter, { userId: 1 });
    assert.equal(fourth.allowed, true);
});

test('redis limiter isolates keys from each other', async () => {
    const limiter = createRedisRateLimiter({
        prefix: 'rl:test',
        windowMs: 60_000,
        max: 1,
        keyGenerator: (req) => `user:${req.userId}`,
        redis: new FakeRedis(),
        now: () => 5_000,
    });

    assert.equal((await invoke(limiter, { userId: 1 })).allowed, true);
    assert.equal((await invoke(limiter, { userId: 1 })).allowed, false);
    assert.equal((await invoke(limiter, { userId: 2 })).allowed, true, 'another user has a separate budget');
});

test('auth limiter throttles the account dimension across addresses', async () => {
    const limiter = createRedisRateLimiter({
        prefix: 'rl:auth',
        windowMs: 60_000,
        max: 2,
        keyGenerator: authRequestKeys,
        redis: new FakeRedis(),
        now: () => 5_000,
    });
    const attempt = (ip, email) => invoke(limiter, { ip, body: { email } });

    assert.equal((await attempt('203.0.113.1', 'victim@example.test')).allowed, true);
    assert.equal((await attempt('203.0.113.2', 'victim@example.test')).allowed, true);
    const blocked = await attempt('203.0.113.3', 'victim@example.test');
    assert.equal(blocked.allowed, false, 'rotating addresses must not bypass the account budget');
    assert.equal(blocked.response.body.error, 'RATE_LIMITED');

    const otherAccount = await attempt('203.0.113.4', 'other@example.test');
    assert.equal(otherAccount.allowed, true, 'an untouched account from a fresh address passes');
});

test('auth keys normalize the email dimension and always include the address', () => {
    assert.deepEqual(
        authRequestKeys({ ip: '203.0.113.9', body: { email: '  OP@Example.TEST ' } }),
        ['ip:203.0.113.9', 'email:op@example.test'],
    );
    assert.deepEqual(authRequestKeys({ ip: '203.0.113.9', body: {} }), ['ip:203.0.113.9']);
    assert.deepEqual(authRequestKeys({ ip: '203.0.113.9', body: { email: 42 } }), ['ip:203.0.113.9']);
    assert.deepEqual(authRequestKeys({ socket: { remoteAddress: '10.0.0.5' } }), ['ip:10.0.0.5']);
});

test('authenticatedUserKey prefers req.user and falls back to the bearer token', () => {
    assert.equal(authenticatedUserKey({ user: { id: 5 }, headers: {} }), 'user:5');

    const token = signAuthToken({ id: 9, orgId: 1, role: 'admin' });
    assert.equal(authenticatedUserKey({ headers: { authorization: `Bearer ${token}` } }), 'user:9');

    assert.equal(authenticatedUserKey({ headers: { authorization: 'Bearer not-a-jwt' } }), null);
    assert.equal(authenticatedUserKey({ headers: {} }), null);
});

test('redis failure fails open and logs once per interval', async () => {
    const redis = new FakeRedis();
    redis.failing = true;
    const logged = [];
    let currentTime = 0;
    const limiter = createRedisRateLimiter({
        prefix: 'rl:test',
        windowMs: 60_000,
        max: 1,
        keyGenerator: () => 'user:1',
        redis,
        now: () => currentTime,
        logger: { error: (message) => logged.push(message) },
        failureLogIntervalMs: 60_000,
    });

    assert.equal((await invoke(limiter, {})).allowed, true);
    currentTime = 1_000;
    assert.equal((await invoke(limiter, {})).allowed, true, 'requests over budget still pass while redis is down');
    assert.equal(logged.length, 1, 'the outage is logged once per interval');

    currentTime = 61_000;
    await invoke(limiter, {});
    assert.equal(logged.length, 2, 'a persisting outage is logged again after the interval');
    assert.match(logged[0], /degraded/);
});

test('redis failure falls back to the in-memory limiter when provided', async () => {
    const redis = new FakeRedis();
    redis.failing = true;
    const now = () => 10_000;
    const limiter = createRedisRateLimiter({
        prefix: 'rl:auth',
        windowMs: 60_000,
        max: 5,
        keyGenerator: authRequestKeys,
        redis,
        now,
        logger: { error: () => {} },
        fallback: createRateLimiter({ windowMs: 60_000, max: 1, now }),
    });

    const request = { ip: '203.0.113.7', body: { email: 'x@example.test' } };
    assert.equal((await invoke(limiter, request)).allowed, true);
    const blocked = await invoke(limiter, request);
    assert.equal(blocked.allowed, false, 'the in-memory fallback keeps throttling');
    assert.equal(blocked.response.statusCode, 429);
    assert.deepEqual(blocked.response.body, { error: 'RATE_LIMITED', retryAfterSeconds: 60 });
    assert.equal(blocked.response.headers['Retry-After'], '60');
});

test('requests without a derivable key skip the limiter entirely', async () => {
    const redis = new FakeRedis();
    redis.failing = true; // would throw if the limiter touched redis
    const limiter = createRedisRateLimiter({
        prefix: 'rl:api',
        windowMs: 60_000,
        max: 1,
        keyGenerator: authenticatedUserKey,
        redis,
        logger: { error: () => { throw new Error('must not log'); } },
    });

    const { allowed, response } = await invoke(limiter, { headers: {} });
    assert.equal(allowed, true);
    assert.equal(response.headers['RateLimit-Limit'], undefined, 'skipped requests get no limiter headers');
});

test('in-memory limiter evicts the entry closest to expiry, not the first-inserted key', () => {
    let currentTime = 0;
    const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        maxEntries: 3,
        now: () => currentTime,
    });
    const hit = (ip) => {
        const response = fakeResponse();
        let allowed = false;
        limiter({ ip, socket: {} }, response, () => { allowed = true; });
        return { allowed, response };
    };

    hit('key-a');                       // key-a window [0, 60000)
    currentTime = 59_000;
    hit('key-b');                       // key-b window [59000, 119000)
    currentTime = 61_000;
    hit('key-a');                       // renewal below capacity: window [61000, 121000), Map position stays first
    currentTime = 62_000;
    hit('key-c');                       // key-c window [62000, 122000); map is now full
    currentTime = 62_500;
    hit('key-d');                       // nothing expired: must evict key-b (closest to expiry), not first-inserted key-a

    currentTime = 63_000;
    const again = hit('key-a');
    assert.equal(again.allowed, false, 'key-a kept its counter, so a second hit in its window is blocked');
    assert.equal(hit('key-b').allowed, true, 'key-b was the evicted entry');
});

test('in-memory limiter returns the standard 429 envelope', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => 0 });
    const request = { ip: '203.0.113.1', socket: {} };

    limiter(request, fakeResponse(), () => {});
    const response = fakeResponse();
    limiter(request, response, () => { throw new Error('must not pass'); });

    assert.equal(response.statusCode, 429);
    assert.deepEqual(response.body, { error: 'RATE_LIMITED', retryAfterSeconds: 60 });
    assert.equal(response.headers['Retry-After'], '60');
});

test('rate limit budgets come from the environment with safe fallbacks', () => {
    assert.equal(integerFromEnv('X', 600, { X: '42' }), 42);
    assert.equal(integerFromEnv('X', 600, {}), 600);
    assert.equal(integerFromEnv('X', 600, { X: 'many' }), 600);
    assert.equal(integerFromEnv('X', 600, { X: '0' }), 600);
    assert.equal(integerFromEnv('X', 600, { X: '-5' }), 600);
    assert.equal(integerFromEnv('X', 600, { X: '2.5' }), 600);
});
