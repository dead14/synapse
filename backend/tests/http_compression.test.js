const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');

process.env.NODE_ENV ||= 'test';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.DB_NAME ||= 'test';
process.env.JWT_SECRET ||= '0123456789abcdef0123456789abcdef';

const app = require('../src/app');

function request(server, path, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            { port: server.address().port, path, headers },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                }));
            },
        );
        req.on('error', reject);
    });
}

async function withServer(run) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        return await run(server);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('responses are negotiated for compression', async () => {
    // An alignment result page is twenty thousand objects repeating the same
    // forty column names — roughly 17 MB raw and 0.7 MB gzipped. Nothing sits
    // in front of Express to compress it, so without this middleware whoever
    // opens a published link waits on the raw bytes.
    const response = await withServer((server) => request(server, '/api/health', {
        'Accept-Encoding': 'gzip',
    }));

    assert.equal(response.status, 200);
    assert.match(String(response.headers.vary || ''), /Accept-Encoding/i);
});

test('a response under the threshold is left uncompressed', async () => {
    // Small bodies cost more in framing than they save, so the health payload
    // the deploy gate reads stays byte-for-byte what it always was.
    const response = await withServer((server) => request(server, '/api/health', {
        'Accept-Encoding': 'gzip',
    }));

    assert.equal(response.headers['content-encoding'], undefined);
    assert.doesNotThrow(() => JSON.parse(response.body.toString('utf8')));
});

test('gzip is what makes a result page affordable to send', () => {
    // Guards the assumption the middleware is there for: this row shape has to
    // stay overwhelmingly compressible, or the threshold above is the wrong
    // trade. Not a test of zlib — a test of the payload we ship.
    const rows = Array.from({ length: 2_000 }, (_, index) => ({
        'Result Group': 'ANOMALY',
        'Match/Unmatch': 'Matched',
        'Source Key OLD': `old:${index}`,
        'Source Key NEW': `new:${index}`,
        'Log Dist OLD (m)': (index * 3.117).toFixed(3),
        'Log Dist NEW (m)': (index * 3.121).toFixed(3),
        'Feature Type NEW': 'Metal Loss',
        'Depth NEW (%WT)': 28.4,
        'Length NEW (mm)': 52,
        'Width NEW (mm)': 21,
        'Wall WT NEW (mm)': 12.7,
        'Section NEW': 'KP 12-18',
    }));
    const json = JSON.stringify({ items: rows, nextCursor: null });
    const ratio = Buffer.byteLength(json) / zlib.gzipSync(json).length;

    assert.ok(ratio > 5, `expected a result page to gzip at better than 5x, got ${ratio.toFixed(1)}x`);
});
