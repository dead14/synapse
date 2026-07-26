const test = require('node:test');
const assert = require('node:assert/strict');
const { healthHandler } = require('../src/config/health');

test('health handler returns the public liveness payload', () => {
    let payload;
    const response = {
        json(value) {
            payload = value;
            return this;
        },
    };

    const returned = healthHandler({}, response);

    assert.equal(returned, response);
    assert.deepEqual(payload, { status: 'ok' });
});
