const test = require('node:test');
const assert = require('node:assert/strict');

const { OwnedJobStore } = require('../src/modules/alignment/ownedJobStore');

test('engineer cannot read another user or organization job', () => {
    const jobs = new OwnedJobStore({ ttlMs: 60_000 });
    jobs.create('job-1', { userId: 10, orgId: 100 });

    assert.equal(jobs.getForPrincipal('job-1', { id: 11, orgId: 100, role: 'engineer' }), null);
    assert.equal(jobs.getForPrincipal('job-1', { id: 10, orgId: 200, role: 'engineer' }), null);
    assert.equal(jobs.getForPrincipal('job-1', { id: 10, orgId: 100, role: 'engineer' }).id, 'job-1');
});

test('organization admin can read a same-organization job only', () => {
    const jobs = new OwnedJobStore({ ttlMs: 60_000 });
    jobs.create('job-1', { userId: 10, orgId: 100 });

    assert.equal(jobs.getForPrincipal('job-1', { id: 99, orgId: 100, role: 'admin' }).id, 'job-1');
    assert.equal(jobs.getForPrincipal('job-1', { id: 99, orgId: 200, role: 'admin' }), null);
});

test('expired jobs are removed', () => {
    let now = 1000;
    const jobs = new OwnedJobStore({ ttlMs: 100, now: () => now });
    jobs.create('job-1', { userId: 10, orgId: 100 });
    now = 1200;

    assert.equal(jobs.getForPrincipal('job-1', { id: 10, orgId: 100, role: 'engineer' }), null);
    assert.equal(jobs.size, 0);
});
