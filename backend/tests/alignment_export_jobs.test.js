const test = require('node:test');
const assert = require('node:assert/strict');

const {
    claimOwnedExportDownload,
    finishExportDownload,
    getOwnedExportJob,
    startExportJob,
} = require('../src/modules/alignment/exportJobs');

async function waitUntil(predicate, timeoutMs = 1_000) {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for export job');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

test('background export is owner-scoped and becomes downloadable when ready', async () => {
    let released = false;
    const job = startExportJob({
        orgId: 22,
        userId: 4,
        rowCount: 500_000,
        run: async () => ({
            filePath: 'C:\\temp\\report.xlsx',
            release: async () => { released = true; },
        }),
    });

    assert.equal(getOwnedExportJob(job.exportId, 99, 4), null);
    await waitUntil(() => getOwnedExportJob(job.exportId, 22, 4)?.state === 'ready');
    assert.deepEqual(getOwnedExportJob(job.exportId, 22, 4), {
        exportId: job.exportId,
        state: 'ready',
        rowCount: 500_000,
        progress: 100,
        message: 'Ready to download',
        error: null,
        code: null,
    });

    const download = claimOwnedExportDownload(job.exportId, 22, 4);
    assert.equal(download.filePath, 'C:\\temp\\report.xlsx');
    assert.equal(claimOwnedExportDownload(job.exportId, 22, 4), null);
    await finishExportDownload(job.exportId);
    assert.equal(released, true);
    assert.equal(getOwnedExportJob(job.exportId, 22, 4), null);
});

test('background export exposes a bounded failure instead of an unhandled rejection', async () => {
    const error = new Error('Excel export timed out');
    error.code = 'EXPORT_TIMEOUT';
    const job = startExportJob({
        orgId: 22,
        userId: 4,
        rowCount: 10,
        run: async () => { throw error; },
    });

    await waitUntil(() => getOwnedExportJob(job.exportId, 22, 4)?.state === 'failed');
    assert.equal(getOwnedExportJob(job.exportId, 22, 4).code, 'EXPORT_TIMEOUT');
    assert.equal(getOwnedExportJob(job.exportId, 22, 4).error, 'Excel export timed out');
});

test('limits retained exports per user while completed files await download', async () => {
    const resolvers = [];
    const run = () => new Promise((resolve) => { resolvers.push(resolve); });
    const first = startExportJob({
        orgId: 44,
        userId: 8,
        rowCount: 500_000,
        run,
    });
    const second = startExportJob({
        orgId: 44,
        userId: 8,
        rowCount: 500_000,
        run,
    });

    assert.throws(
        () => startExportJob({
            orgId: 44,
            userId: 8,
            rowCount: 500_000,
            run,
        }),
        (error) => error?.code === 'EXPORT_BUSY',
    );

    await waitUntil(() => resolvers.length === 2);
    resolvers[0]({ filePath: 'first.xlsx', release: async () => {} });
    resolvers[1]({ filePath: 'second.xlsx', release: async () => {} });
    await waitUntil(() => getOwnedExportJob(first.exportId, 44, 8)?.state === 'ready');
    await waitUntil(() => getOwnedExportJob(second.exportId, 44, 8)?.state === 'ready');
    claimOwnedExportDownload(first.exportId, 44, 8);
    claimOwnedExportDownload(second.exportId, 44, 8);
    await finishExportDownload(first.exportId);
    await finishExportDownload(second.exportId);
});
