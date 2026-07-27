const pool = require('../../config/db');

async function writeAuditLog({
    userId = null,
    organizationId = null,
    action,
    target = null,
    ipAddress = null,
}, query = pool.query.bind(pool)) {
    try {
        await query(
            `INSERT INTO activity_logs
                (user_id, organization_id, action, target, ip_address)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, organizationId, action, target, ipAddress],
        );
    } catch (error) {
        console.error('Failed to write audit log:', error.message);
    }
}

module.exports = { writeAuditLog };
