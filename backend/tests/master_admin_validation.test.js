const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parsePage,
    parsePageSize,
    validateOrganizationLimits,
} = require('../src/modules/masterAdmin/masterAdminValidation');
const { validatePasswordResetRequest } = require('../src/modules/auth/authValidation');
const { isSuperAdmin } = require('../src/modules/users/userAccess');

test('master access is granted only to the existing super_admin role', () => {
    assert.equal(isSuperAdmin({ role: 'super_admin' }), true);
    assert.equal(isSuperAdmin({ role: 'admin' }), false);
    assert.equal(isSuperAdmin(undefined), false);
});

test('organization limits fail closed outside safe integer bounds', () => {
    assert.equal(validateOrganizationLimits({ maxUsers: 0, maxPipelines: 1, isActive: true }).ok, false);
    assert.equal(validateOrganizationLimits({ maxUsers: 10, maxPipelines: 10001, isActive: true }).ok, false);
    assert.equal(validateOrganizationLimits({ maxUsers: 10, maxPipelines: 2, isActive: 'true' }).ok, false);
    assert.deepEqual(
        validateOrganizationLimits({ maxUsers: 10, maxPipelines: 2, isActive: false }),
        { ok: true, value: { maxUsers: 10, maxPipelines: 2, isActive: false } },
    );
});

test('master audit pagination is bounded', () => {
    assert.equal(parsePage('2'), 2);
    assert.equal(parsePage('-1'), 1);
    assert.equal(parsePageSize('500'), 100);
});

test('password recovery normalizes a valid email and rejects invalid input', () => {
    assert.deepEqual(
        validatePasswordResetRequest({ email: '  USER@Example.COM ' }),
        { ok: true, value: { email: 'user@example.com' } },
    );
    assert.equal(validatePasswordResetRequest({ email: 'not-an-email' }).ok, false);
});
