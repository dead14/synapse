const pool = require('../../config/db');
const { isSuperAdmin } = require('../users/userAccess');

exports.listOrganizations = async (req, res) => {
    const organizationId = Number(req.user.orgId);
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
        return res.status(400).json({ error: 'A valid organization scope is required' });
    }

    try {
        const result = isSuperAdmin(req.user)
            ? await pool.query('SELECT id, name, slug, created_at FROM organizations ORDER BY name ASC')
            : await pool.query(
                'SELECT id, name, slug, created_at FROM organizations WHERE id = $1',
                [organizationId],
            );
        return res.json(result.rows);
    } catch (error) {
        console.error('List organizations error:', error);
        return res.status(500).json({ error: 'Failed to fetch organizations' });
    }
};
