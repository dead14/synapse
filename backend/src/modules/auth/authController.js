const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const { JWT_SECRET } = require('../../middlewares/authMiddleware');

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

// Register: creates org + admin user
exports.register = async (req, res) => {
    const { orgName, username, email, password } = req.body;
    if (!orgName || !username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        
        const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const orgResult = await pool.query(
            'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
            [orgName, slug]
        );
        const orgId = orgResult.rows[0].id;
        
        const passwordHash = await bcrypt.hash(password, 12);
        const userResult = await pool.query(
            'INSERT INTO users (organization_id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role',
            [orgId, username, email, passwordHash, 'admin']
        );
        const user = userResult.rows[0];
        
        const token = jwt.sign(
            { id: user.id, orgId, role: user.role, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        await logActivity(user.id, orgId, 'Registered new organization', orgName, req.ip);
        res.json({ token, user: { ...user, orgId, orgName } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed', details: err.message });
    }
};

// Login
exports.login = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.email, u.password_hash, u.role, u.organization_id,
                    o.name as org_name
             FROM users u
             JOIN organizations o ON u.organization_id = o.id
             WHERE u.email = $1 AND u.is_active = true`,
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
        
        const token = jwt.sign(
            { id: user.id, orgId: user.organization_id, role: user.role, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        await logActivity(user.id, user.organization_id, 'User Login', 'System', req.ip);
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                orgId: user.organization_id,
                orgName: user.org_name
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed', details: err.message });
    }
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
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
};
