const ASSIGNABLE_ROLES = new Set(['user', 'engineer', 'viewer', 'admin', 'super_admin']);

function isSuperAdmin(actor) {
    return actor?.role === 'super_admin';
}

function canAssignRole(actor, requestedRole) {
    if (!ASSIGNABLE_ROLES.has(requestedRole)) return false;
    return requestedRole !== 'super_admin' || isSuperAdmin(actor);
}

function buildUserMutationScope(actor, targetUserId, parameterOffset = 1) {
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        throw new TypeError('targetUserId must be a positive integer');
    }

    const userParameter = `$${parameterOffset}`;
    if (isSuperAdmin(actor)) {
        return {
            clause: `id = ${userParameter}`,
            values: [targetUserId],
        };
    }

    const organizationId = Number(actor?.orgId);
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        throw new TypeError('Organization-scoped administrators require a valid orgId');
    }

    return {
        clause: `id = ${userParameter} AND organization_id = $${parameterOffset + 1}`,
        values: [targetUserId, organizationId],
    };
}

module.exports = {
    ASSIGNABLE_ROLES,
    buildUserMutationScope,
    canAssignRole,
    isSuperAdmin,
};
