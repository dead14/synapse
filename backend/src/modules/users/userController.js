const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const { validateEmail } = require('../auth/authValidation');
const {
    buildUserMutationScope,
    canAssignRole,
    isSuperAdmin,
} = require('./userAccess');

function parsePositiveInteger(value) {
    if (!/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveOrganizationScope(req) {
    const requestedOrganization = req.query?.organizationId;
    if (requestedOrganization !== undefined && !isSuperAdmin(req.user)) return null;
    return parsePositiveInteger(requestedOrganization ?? req.user.orgId);
}

exports.getUsers = async (req, res) => {
    const organizationId = resolveOrganizationScope(req);
    if (!organizationId) {
        return res.status(400).json({ error: 'A valid organization scope is required' });
    }
    try {
        const result = await pool.query(
            `SELECT u.id, u.organization_id, u.username, u.email, u.role, u.is_active, u.created_at,
                    o.name AS org_name
             FROM users u
             JOIN organizations o ON o.id = u.organization_id
             WHERE u.organization_id = $1 
             ORDER BY created_at DESC`,
            [organizationId]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error('Fetch users error:', err);
        return res.status(500).json({ error: 'Failed to fetch users' });
    }
};

exports.createUser = async (req, res) => {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = req.body.role || 'user';

    if (username.length < 2 || username.length > 80 || !validateEmail(email)) {
        return res.status(400).json({ error: 'A valid username and email are required' });
    }
    if (password.length < 12 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be between 12 and 128 characters' });
    }
    if (!canAssignRole(req.user, role)) {
        return res.status(403).json({ error: 'The requested role cannot be assigned' });
    }

    const requestedOrganizationId = req.body.organization_id;
    const organizationId = isSuperAdmin(req.user)
        ? parsePositiveInteger(requestedOrganizationId ?? req.user.orgId)
        : parsePositiveInteger(req.user.orgId);
    if (!organizationId) {
        return res.status(400).json({ error: 'A valid organization scope is required' });
    }
    if (!isSuperAdmin(req.user) && requestedOrganizationId !== undefined && Number(requestedOrganizationId) !== organizationId) {
        return res.status(403).json({ error: 'Users can only be created in your organization' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            'INSERT INTO users (organization_id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role, is_active, created_at',
            [organizationId, username, email, passwordHash, role]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create user error:', err);
        if (err.constraint === 'users_email_key') {
            return res.status(409).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: 'Failed to create user' });
    }
};

exports.resetPassword = async (req, res) => {
    const id = parsePositiveInteger(req.params.id);
    const { newPassword } = req.body;
    if (!id) {
        return res.status(400).json({ error: 'Invalid user id' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
        return res.status(400).json({ error: 'New password must be between 12 and 128 characters' });
    }
    try {
        const passwordHash = await bcrypt.hash(newPassword, 12);
        const scope = buildUserMutationScope(req.user, id, 2);
        const result = await pool.query(
            `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE ${scope.clause} RETURNING id`,
            [passwordHash, ...scope.values],
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ message: 'Password reset successful' });
    } catch (err) {
        console.error('Reset password error:', err);
        return res.status(500).json({ error: 'Failed to reset password' });
    }
};

exports.toggleStatus = async (req, res) => {
    const id = parsePositiveInteger(req.params.id);
    const { is_active } = req.body;
    if (!id) {
        return res.status(400).json({ error: 'Invalid user id' });
    }
    if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active must be a boolean' });
    }
    try {
        const scope = buildUserMutationScope(req.user, id, 2);
        const result = await pool.query(
            `UPDATE users SET is_active = $1, updated_at = NOW() WHERE ${scope.clause} RETURNING id`,
            [is_active, ...scope.values],
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ message: 'User status updated' });
    } catch (err) {
        console.error('Update status error:', err);
        return res.status(500).json({ error: 'Failed to update user status' });
    }
};

exports.parsePositiveInteger = parsePositiveInteger;
exports.resolveOrganizationScope = resolveOrganizationScope;
