function sslConfig(env) {
    if (env.DB_SSL !== 'true') return undefined;
    return {
        rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
}

function buildDatabaseConfig(env = process.env) {
    const connectionString = env.DATABASE_URL?.trim();
    if (connectionString) {
        const ssl = sslConfig(env);
        return ssl ? { connectionString, ssl } : { connectionString };
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
    };
    const ssl = sslConfig(env);
    if (ssl) config.ssl = ssl;
    return config;
}

module.exports = { buildDatabaseConfig };
