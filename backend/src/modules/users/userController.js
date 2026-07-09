const bcrypt = require('bcryptjs');
const pool = require('../../config/db');

exports.getUsers = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, email, role, is_active, created_at 
             FROM users 
             WHERE organization_id = $1 
             ORDER BY created_at DESC`,
            [req.user.orgId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Fetch users error:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
};

exports.createUser = async (req, res) => {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            'INSERT INTO users (organization_id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role, is_active, created_at',
            [req.user.orgId, username, email, passwordHash, role || 'user']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create user error:', err);
        if (err.constraint === 'users_email_key') {
            return res.status(409).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Failed to create user' });
    }
};

exports.resetPassword = async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword) {
        return res.status(400).json({ error: 'New password is required' });
    }
    try {
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, id]);
        res.json({ message: 'Password reset successful' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
};

exports.toggleStatus = async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;
    try {
        await pool.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [is_active, id]);
        res.json({ message: 'User status updated' });
    } catch (err) {
        console.error('Update status error:', err);
        res.status(500).json({ error: 'Failed to update user status' });
    }
};
