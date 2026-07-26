const pool = require('../../config/db');
const { parseRequirement } = require('./complianceContract');
const { createOwnedRequirement, listOwnedRequirements } = require('./complianceRepository');

exports.listRequirements = async (req, res) => {
    try {
        const items = await listOwnedRequirements(pool, req.user.orgId);
        const gaps = items.filter((item) => Number(item.applicable_links) === 0 || Number(item.accepted_links) < Number(item.applicable_links));
        return res.json({
            items,
            readiness: {
                requirements: items.length,
                accepted: items.length - gaps.length,
                gaps: gaps.length,
                ready: items.length > 0 && gaps.length === 0,
            },
        });
    } catch (error) {
        console.error('List compliance requirements error:', error);
        return res.status(500).json({ error: 'Failed to list compliance requirements' });
    }
};

exports.createRequirement = async (req, res) => {
    try {
        return res.status(201).json(await createOwnedRequirement(pool, req.user.orgId, parseRequirement(req.body)));
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Requirement code and edition already exist' });
        return res.status(400).json({ error: error.message, code: 'INVALID_COMPLIANCE_REQUIREMENT' });
    }
};
