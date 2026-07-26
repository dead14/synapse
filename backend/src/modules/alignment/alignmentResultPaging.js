const DEFAULT_ALIGNMENT_RESULT_PAGE_SIZE = 1_000;
const MAX_ALIGNMENT_RESULT_PAGE_SIZE = 20_000;

function parseAlignmentResultPageQuery(query = {}) {
    const limit = query.limit === undefined
        ? DEFAULT_ALIGNMENT_RESULT_PAGE_SIZE
        : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ALIGNMENT_RESULT_PAGE_SIZE) {
        throw new RangeError(
            `limit must be an integer between 1 and ${MAX_ALIGNMENT_RESULT_PAGE_SIZE}`,
        );
    }

    let after = null;
    if (query.cursor !== undefined && query.cursor !== '') {
        after = Number(query.cursor);
        if (!Number.isSafeInteger(after) || after < 0) {
            throw new RangeError('cursor must be a non-negative result ordinal');
        }
    }

    return { limit, after };
}

module.exports = {
    DEFAULT_ALIGNMENT_RESULT_PAGE_SIZE,
    MAX_ALIGNMENT_RESULT_PAGE_SIZE,
    parseAlignmentResultPageQuery,
};
