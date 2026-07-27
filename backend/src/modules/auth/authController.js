const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const pool = require('../../config/db');
const {
    clearAuthCookie,
    extractAuthToken,
    setAuthCookie,
    signAuthToken,
    verifyAuthToken,
} = require('../../middlewares/authMiddleware');
const { bumpTokenVersion } = require('../../middlewares/principalCache');
const {
    validateLoginInput,
    validatePasswordResetRequest,
    validateRegistrationInput,
} = require('./authValidation');

// Log Activity Helper
const logActivity = async (userId, orgId, action, target, ipAddress) => {
    try {
        await pool.query(
            'INSERT INTO activity_logs (user_id, organization_id, action, target, ip_address) VALUES ($1, $2, $3, $4, $5)',
            [userId, orgId, action, target, ipAddress]
        );
    } catch (err) {
        console.error('Failed to log activity:', err);
    }
};

function publicUser(user, orgId, orgName) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        orgId,
        orgName,
    };
}

function createOrganizationSlug(orgName) {
    const base = orgName
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'organization';
    return `${base.slice(0, 80)}-${crypto.randomBytes(4).toString('hex')}`;
}

// Register: creates org + admin user
exports.register = async (req, res) => {
    const validation = validateRegistrationInput(req.body);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
    }

    const { orgName, username, email, password } = validation.value;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Email already registered' });
        }

        const slug = createOrganizationSlug(orgName);
        const orgResult = await client.query(
            'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
            [orgName, slug]
        );
        const orgId = orgResult.rows[0].id;

        const passwordHash = await bcrypt.hash(password, 12);
        const userResult = await client.query(
            'INSERT INTO users (organization_id, username, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, COALESCE(token_version, 0) AS token_version',
            [orgId, username, email, passwordHash, 'admin']
        );
        const user = userResult.rows[0];

        await client.query('COMMIT');

        const token = signAuthToken({
            id: user.id,
            orgId,
            role: user.role,
            username: user.username,
            email: user.email,
            tv: Number(user.token_version) || 0,
        });
        setAuthCookie(res, token);
        res.setHeader('Cache-Control', 'no-store');

        await logActivity(user.id, orgId, 'Registered new organization', orgName, req.ip);
        return res.status(201).json({ user: publicUser(user, orgId, orgName) });
    } catch (err) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Registration rollback failed:', rollbackError);
            }
        }
        console.error('Register error:', err);
        if (err.constraint === 'users_email_key') {
            return res.status(409).json({ error: 'Email already registered' });
        }
        return res.status(500).json({ error: 'Registration failed' });
    } finally {
        client?.release();
    }
};

// Login
exports.login = async (req, res) => {
    const validation = validateLoginInput(req.body);
    if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
    }
    const { email, password } = validation.value;
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.email, u.password_hash, u.role, u.organization_id,
                    COALESCE(u.token_version, 0) AS token_version,
                    o.name as org_name
             FROM users u
             JOIN organizations o ON u.organization_id = o.id
             WHERE u.email = $1 AND COALESCE(u.is_active, true) = true
               AND COALESCE(o.is_active, true) = true`,
            [email]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        const token = signAuthToken({
            id: user.id,
            orgId: user.organization_id,
            role: user.role,
            username: user.username,
            email: user.email,
            tv: Number(user.token_version) || 0,
        });
        setAuthCookie(res, token);
        res.setHeader('Cache-Control', 'no-store');

        await logActivity(user.id, user.organization_id, 'User Login', 'System', req.ip);
        return res.json({
            user: publicUser(user, user.organization_id, user.org_name),
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Login failed' });
    }
};

exports.requestPasswordReset = async (req, res) => {
    const validation = validatePasswordResetRequest(req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    // The same response is returned whether the email exists or not to prevent
    // account enumeration from this unauthenticated endpoint.
    const response = {
        message: 'If the account exists, a recovery request has been sent to the master administrator.',
    };
    try {
        const user = await pool.query(
            `SELECT u.id, u.organization_id
             FROM users u JOIN organizations o ON o.id = u.organization_id
             WHERE u.email = $1 AND u.is_active = true AND o.is_active = true`,
            [validation.value.email],
        );
        if (user.rowCount) {
            const account = user.rows[0];
            await pool.query(
                `INSERT INTO password_reset_requests
                    (user_id, organization_id, requested_ip)
                 SELECT $1, $2, $3
                 WHERE NOT EXISTS (
                     SELECT 1 FROM password_reset_requests
                     WHERE user_id = $1 AND status = 'pending'
                       AND requested_at > NOW() - INTERVAL '15 minutes'
                 )`,
                [account.id, account.organization_id, req.ip],
            );
        }
        return res.status(202).json(response);
    } catch (error) {
        console.error('Password reset request error:', error);
        return res.status(202).json(response);
    }
};

// Logout stays unauthenticated and best-effort: clearing the cookie must
// always succeed.  When the caller presents a valid token, their
// token_version is bumped so every outstanding copy of the session — a
// stolen bearer token included — dies immediately instead of at JWT expiry.
exports.logout = async (req, res) => {
    const token = extractAuthToken(req);
    if (token) {
        try {
            const decoded = verifyAuthToken(token);
            await bumpTokenVersion((text, values) => pool.query(text, values), Number(decoded.id));
        } catch (err) {
            // An expired/forged token or an unavailable database must not
            // block logout; the cookie is cleared regardless.
            console.error('Logout token revocation skipped:', err.message);
        }
    }
    clearAuthCookie(res);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ message: 'Logged out' });
};

// Get current user profile
exports.getMe = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.email, u.role, u.organization_id,
                    o.name as org_name
             FROM users u
             JOIN organizations o ON u.organization_id = o.id
             WHERE u.id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const user = result.rows[0];
        res.setHeader('Cache-Control', 'no-store');
        return res.json(publicUser(user, user.organization_id, user.org_name));
    } catch (err) {
        console.error('Fetch profile error:', err);
        return res.status(500).json({ error: 'Failed to fetch profile' });
    }
};

exports.createOrganizationSlug = createOrganizationSlug;
