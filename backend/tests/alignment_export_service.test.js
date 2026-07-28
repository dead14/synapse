const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { spoolExportRows } = require('../src/modules/alignment/exportService');

async function* rows(values) {
    for (const value of values) yield value;
}

test('spools result rows as NDJSON with bounded metadata instead of one JSON array', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-export-'));
    const rowsPath = path.join(directory, 'rows.ndjson');
    const metadataPath = path.join(directory, 'metadata.json');
    try {
        const result = await spoolExportRows({
            rows: rows([
                { id: 1, name: 'one', __browserOnly: true },
                { id: 2, nested: [{ code: 'REVIEW' }] },
            ]),
            rowsPath,
            metadataPath,
            pipelineData: { pipelineName: 'North Line' },
            maxRows: 500_000,
        });

        assert.equal(result.rowCount, 2);
        assert.deepEqual(result.headers, ['id', 'name', 'nested']);
        assert.equal((await fs.readFile(rowsPath, 'utf8')).trim().split('\n').length, 2);
        assert.deepEqual(
            JSON.parse(await fs.readFile(metadataPath, 'utf8')),
            {
                pipelineData: { pipelineName: 'North Line' },
                headers: ['id', 'name', 'nested'],
                rowCount: 2,
            },
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('spooling aborts before writing more than the configured Excel row budget', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-export-'));
    try {
        await assert.rejects(
            spoolExportRows({
                rows: rows([{ id: 1 }, { id: 2 }]),
                rowsPath: path.join(directory, 'rows.ndjson'),
                metadataPath: path.join(directory, 'metadata.json'),
                pipelineData: {},
                maxRows: 1,
            }),
            (error) => error?.code === 'EXPORT_TOO_LARGE',
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('spooling reports a storage write failure without an unhandled stream error', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-export-'));
    const missingDirectory = path.join(directory, 'missing');
    try {
        await assert.rejects(
            spoolExportRows({
                rows: rows([{ id: 1 }]),
                rowsPath: path.join(missingDirectory, 'rows.ndjson'),
                metadataPath: path.join(missingDirectory, 'metadata.json'),
                pipelineData: {},
                maxRows: 500_000,
            }),
            /ENOENT/,
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
