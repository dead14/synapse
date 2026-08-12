const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.DB_NAME ||= 'test';

const repository = require('../src/modules/ffs/ffsCandidateRepository');
const { currentResultSignature } = require('../src/modules/ffs/ffsEligibility');

// The controller destructures the repository at require time, so the stubs go
// in before it is loaded.
const stubs = {
    session: null,
    sourceKeys: new Set(),
    stored: [],
};
repository.findOwnedSessionForReview = async () => stubs.session;
repository.listResultSourceKeys = async () => stubs.sourceKeys;
repository.listFfsCandidates = async () => stubs.stored;
repository.replaceFfsCandidates = async (_pool, { items }) => {
    stubs.stored = items.map((item) => ({ ...item, signature: 'sig', reviewedBy: 4, reviewedAt: 'now' }));
    return stubs.stored;
};

const controller = require('../src/modules/ffs/ffsCandidateController');

function completedSession() {
    return {
        id: 7,
        status: 'completed',
        params_json: {
            algorithm: 'dtw_hungarian_onedirection',
            resultSummary: { anomaliesFound: 12 },
        },
    };
}

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

test('a saved review answers with the same gate the page loaded with', async () => {
    // Without `reviewable`, the page that had just validated a population read
    // it as undefined: it raised "this session cannot be released to FFS" with
    // no reason and disabled the button that had worked a moment earlier.
    stubs.session = completedSession();
    stubs.sourceKeys = new Set(['NEW-1', 'NEW-2']);
    stubs.stored = [];

    const res = responseRecorder();
    await controller.saveCandidates({
        params: { id: '7' },
        user: { orgId: 22, id: 4 },
        body: {
            signature: currentResultSignature(stubs.session),
            items: [
                { sourceKey: 'NEW-1', selected: true },
                { sourceKey: 'NEW-2', selected: true },
            ],
        },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reviewable, true);
    assert.equal(res.body.reason, null);
    assert.equal(res.body.stale, false);
    assert.equal(res.body.selectedCount, 2);
});

test('a review naming features outside the result is refused', async () => {
    stubs.session = completedSession();
    stubs.sourceKeys = new Set(['NEW-1']);

    const res = responseRecorder();
    await controller.saveCandidates({
        params: { id: '7' },
        user: { orgId: 22, id: 4 },
        body: {
            signature: currentResultSignature(stubs.session),
            items: [{ sourceKey: 'NEW-9', selected: true }],
        },
    }, res);

    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'UNKNOWN_FFS_CANDIDATE_KEY');
});
