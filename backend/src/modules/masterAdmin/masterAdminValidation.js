function parsePage(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value, fallback = 25) {
    return Math.min(parsePage(value, fallback), 100);
}

function validateOrganizationLimits(input = {}) {
    const maxUsers = Number(input.maxUsers);
    const maxPipelines = Number(input.maxPipelines);
    const isActive = input.isActive;
    if (!Number.isSafeInteger(maxUsers) || maxUsers < 1 || maxUsers > 10000) {
        return { ok: false, error: 'maxUsers must be between 1 and 10000' };
    }
    if (!Number.isSafeInteger(maxPipelines) || maxPipelines < 1 || maxPipelines > 10000) {
        return { ok: false, error: 'maxPipelines must be between 1 and 10000' };
    }
    if (typeof isActive !== 'boolean') {
        return { ok: false, error: 'isActive must be a boolean' };
    }
    return { ok: true, value: { maxUsers, maxPipelines, isActive } };
}

module.exports = { parsePage, parsePageSize, validateOrganizationLimits };
