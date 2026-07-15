const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value) {
    return typeof value === 'string'
        && value.length <= 254
        && EMAIL_PATTERN.test(value);
}

function validateLoginInput(input = {}) {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';

    if (!validateEmail(email) || password.length < 1 || password.length > 128) {
        return { ok: false, error: 'Invalid email or password' };
    }

    return { ok: true, value: { email, password } };
}

function validateRegistrationInput(input = {}) {
    const orgName = typeof input.orgName === 'string' ? input.orgName.trim() : '';
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';

    if (orgName.length < 2 || orgName.length > 100) {
        return { ok: false, error: 'Organization name must be between 2 and 100 characters' };
    }
    if (username.length < 2 || username.length > 80) {
        return { ok: false, error: 'Username must be between 2 and 80 characters' };
    }
    if (!validateEmail(email)) {
        return { ok: false, error: 'A valid email address is required' };
    }
    if (password.length < 12 || password.length > 128) {
        return { ok: false, error: 'Password must be between 12 and 128 characters' };
    }

    return {
        ok: true,
        value: { orgName, username, email, password },
    };
}

module.exports = {
    validateEmail,
    validateLoginInput,
    validateRegistrationInput,
};
