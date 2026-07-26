function sslConfig(env) {
    if (env.DB_SSL !== 'true') return undefined;
    return {
        rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
}

function positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// pg defaults to max:10 and connectionTimeoutMillis:0 (wait forever) with no
// statement timeout.  The pool is shared with the in-process BullMQ workers, so
// one slow scan otherwise pins every connection and later requests hang instead
// of failing fast.
function poolTuning(env) {
    return {
        max: positiveInt(env.DB_POOL_MAX, 20),
        idleTimeoutMillis: positiveInt(env.DB_IDLE_TIMEOUT_MS, 30000),
        connectionTimeoutMillis: positiveInt(env.DB_CONNECTION_TIMEOUT_MS, 5000),
        statement_timeout: positiveInt(env.DB_STATEMENT_TIMEOUT_MS, 30000),
        query_timeout: positiveInt(env.DB_QUERY_TIMEOUT_MS, 30000),
        application_name: env.DB_APPLICATION_NAME || 'synapse-api',
    };
}

function buildDatabaseConfig(env = process.env) {
    const connectionString = env.DATABASE_URL?.trim();
    if (connectionString) {
        const ssl = sslConfig(env);
        return { connectionString, ...poolTuning(env), ...(ssl ? { ssl } : {}) };
    }

    const requiredKeys = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingKeys = requiredKeys.filter((key) => !env[key]?.trim());
    if (missingKeys.length) {
        throw new Error(
            `Database configuration is missing. Set DATABASE_URL or DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (missing: ${missingKeys.join(', ')})`,
        );
    }

    const port = Number(env.DB_PORT || 5432);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('DB_PORT must be an integer between 1 and 65535');
    }

    const config = {
        host: env.DB_HOST.trim(),
        port,
        database: env.DB_NAME.trim(),
        user: env.DB_USER.trim(),
        password: env.DB_PASSWORD,
        ...poolTuning(env),
    };
    const ssl = sslConfig(env);
    if (ssl) config.ssl = ssl;
    return config;
}

module.exports = { buildDatabaseConfig };
