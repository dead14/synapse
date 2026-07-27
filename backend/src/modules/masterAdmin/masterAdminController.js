const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const { invalidatePrincipal } = require('../../middlewares/principalCache');
const { writeAuditLog } = require('../audit/auditLog');
const { parsePage, parsePageSize, validateOrganizationLimits } = require('./masterAdminValidation');

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

exports.getOverview = async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM organizations) AS organizations,
                (SELECT COUNT(*) FROM organizations WHERE is_active) AS active_organizations,
                (SELECT COUNT(*) FROM users) AS users,
                (SELECT COUNT(*) FROM users WHERE is_active) AS active_users,
                (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '30 days') AS registrations_30d,
                (SELECT COUNT(*) FROM password_reset_requests WHERE status = 'pending') AS pending_resets
        `);
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Master overview error:', error);
        return res.status(500).json({ error: 'Failed to fetch master admin overview' });
    }
};

exports.getOrganizations = async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.id, o.name, o.slug, o.plan, o.is_active, o.max_users, o.max_pipelines,
                   o.created_at, COUNT(DISTINCT u.id) AS user_count,
                   COUNT(DISTINCT p.id) AS pipeline_count,
                   COALESCE(
                       json_agg(DISTINCT jsonb_build_object(
                           'id', u.id, 'username', u.username, 'email', u.email,
                           'role', u.role, 'isActive', u.is_active, 'createdAt', u.created_at
                       )) FILTER (WHERE u.id IS NOT NULL), '[]'
                   ) AS members
            FROM organizations o
            LEFT JOIN users u ON u.organization_id = o.id
            LEFT JOIN pipelines p ON p.organization_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at DESC, o.id DESC
        `);
        return res.json(result.rows);
    } catch (error) {
        console.error('Master organizations error:', error);
        return res.status(500).json({ error: 'Failed to fetch organizations' });
    }
};

exports.updateOrganizationLimits = async (req, res) => {
    const organizationId = positiveId(req.params.id);
    const validation = validateOrganizationLimits(req.body);
    if (!organizationId || !validation.ok) {
        return res.status(400).json({ error: validation.error || 'Invalid organization id' });
    }
    const { maxUsers, maxPipelines, isActive } = validation.value;
    try {
        const result = await pool.query(
            `UPDATE organizations
             SET max_users = $1, max_pipelines = $2, is_active = $3
             WHERE id = $4
             RETURNING id, name, is_active, max_users, max_pipelines`,
            [maxUsers, maxPipelines, isActive, organizationId],
        );
        if (!result.rowCount) return res.status(404).json({ error: 'Organization not found' });
        await writeAuditLog({
            userId: req.user.id,
            organizationId,
            action: 'Organization limits updated',
            target: `users=${maxUsers}; pipelines=${maxPipelines}; active=${isActive}`,
            ipAddress: req.ip,
        });
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Update organization limits error:', error);
        return res.status(500).json({ error: 'Failed to update organization limits' });
    }
};

exports.getAuditLogs = async (req, res) => {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const offset = (page - 1) * pageSize;
    try {
        const result = await pool.query(
            `SELECT a.id, a.action, a.target, a.ip_address, a.timestamp AS created_at,
                    u.username, u.email, o.id AS organization_id, o.name AS organization_name,
                    COUNT(*) OVER() AS total_items
             FROM activity_logs a
             LEFT JOIN users u ON u.id = a.user_id
             LEFT JOIN organizations o ON o.id = a.organization_id
             ORDER BY a.timestamp DESC, a.id DESC LIMIT $1 OFFSET $2`,
            [pageSize, offset],
        );
        const totalItems = Number(result.rows[0]?.total_items || 0);
        return res.json({ data: result.rows, pagination: { page, pageSize, totalItems } });
    } catch (error) {
        console.error('Master audit logs error:', error);
        return res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
};

exports.getPasswordResetRequests = async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.id, r.status, r.requested_at, r.requested_ip, r.resolved_at,
                   u.id AS user_id, u.username, u.email, o.id AS organization_id,
                   o.name AS organization_name
            FROM password_reset_requests r
            JOIN users u ON u.id = r.user_id
            JOIN organizations o ON o.id = r.organization_id
            ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
                     r.requested_at DESC
            LIMIT 100
        `);
        return res.json(result.rows);
    } catch (error) {
        console.error('Password reset queue error:', error);
        return res.status(500).json({ error: 'Failed to fetch password reset requests' });
    }
};

exports.resolvePasswordReset = async (req, res) => {
    const requestId = positiveId(req.params.id);
    const newPassword = req.body?.newPassword;
    if (!requestId || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
        return res.status(400).json({ error: 'A password of 8 to 128 characters is required' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const request = await client.query(
            `SELECT id, user_id, organization_id FROM password_reset_requests
             WHERE id = $1 AND status = 'pending' FOR UPDATE`,
            [requestId],
        );
        if (!request.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pending reset request not found' });
        }
        const row = request.rows[0];
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await client.query(
            `UPDATE users SET password_hash = $1,
                token_version = COALESCE(token_version, 0) + 1, updated_at = NOW()
             WHERE id = $2`,
            [passwordHash, row.user_id],
        );
        await client.query(
            `UPDATE password_reset_requests SET status = 'resolved',
                resolved_at = NOW(), resolved_by = $1 WHERE id = $2`,
            [req.user.id, requestId],
        );
        await client.query('COMMIT');
        invalidatePrincipal(Number(row.user_id));
        await writeAuditLog({
            userId: req.user.id,
            organizationId: row.organization_id,
            action: 'Password reset resolved',
            target: `user:${row.user_id}`,
            ipAddress: req.ip,
        });
        return res.json({ message: 'Password reset completed and existing sessions revoked' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Resolve password reset error:', error);
        return res.status(500).json({ error: 'Failed to resolve password reset' });
    } finally {
        client.release();
    }
};
