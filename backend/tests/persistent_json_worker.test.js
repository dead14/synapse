const test = require('node:test');
const assert = require('node:assert/strict');

const { PersistentJsonWorker, restartDelayMs } = require('../src/python/persistentJsonWorker');
const { FakeChildProcess, quietLog, wait } = require('./helpers/fakeChildProcess');

function createWorker(overrides = {}) {
    const children = [];
    const worker = new PersistentJsonWorker({
        name: 'Fake',
        command: 'fake-python',
        args: ['engine.py'],
        spawnFn: () => {
            const child = new FakeChildProcess();
            children.push(child);
            return child;
        },
        restartBaseDelayMs: 10,
        restartMaxDelayMs: 40,
        healthyAfterMs: 60_000,
        log: quietLog,
        ...overrides,
    });
    return { worker, children };
}

test('resolves pending requests by requestId across chunked stdout lines', async () => {
    const { worker, children } = createWorker();
    worker.start();
    const [child] = children;

    const first = worker.sendRequest({ value: 'a' }, 5_000);
    const second = worker.sendRequest({ value: 'b' }, 5_000);
    assert.equal(worker.state().pendingRequests, 2);

    const firstId = JSON.parse(child.stdin.writes[0]).requestId;
    const secondId = JSON.parse(child.stdin.writes[1]).requestId;
    assert.notEqual(firstId, secondId);

    // Out-of-order responses, one of them split across two data events.
    child.respond({ requestId: secondId, success: true, value: 'b' });
    const firstLine = JSON.stringify({ requestId: firstId, success: true, value: 'a' }) + '\n';
    child.stdout.emit('data', Buffer.from(firstLine.slice(0, 7)));
    child.stdout.emit('data', Buffer.from(firstLine.slice(7)));

    assert.equal((await first).value, 'a');
    assert.equal((await second).value, 'b');
    assert.equal(worker.state().pendingRequests, 0);

    worker.stop();
});

test('a completed round-trip resets the consecutive failure counter', async () => {
    const { worker, children } = createWorker();
    worker.start();
    worker.consecutiveFailures = 3;

    const pendingResult = worker.sendRequest({ value: 1 }, 5_000);
    children[0].respond({ requestId: children[0].stdin.lastRequest().requestId, success: true });
    await pendingResult;

    assert.equal(worker.state().consecutiveFailures, 0);
    worker.stop();
});

test('spawn failure rejects pending work and schedules a backoff restart', async () => {
    const { worker, children } = createWorker();
    worker.start();

    const pendingResult = worker.sendRequest({ value: 1 }, 5_000);
    children[0].emit('error', new Error('spawn fake-python ENOENT'));

    await assert.rejects(pendingResult, /Fake Python worker failed to start: spawn fake-python ENOENT/);
    assert.deepEqual(worker.state(), {
        alive: false,
        restarting: true,
        consecutiveFailures: 1,
        pendingRequests: 0,
    });

    // The restart timer (base delay 10 ms) must respawn through spawnFn.
    await wait(30);
    assert.equal(children.length, 2);

    // A second consecutive failure keeps counting up.
    children[1].emit('error', new Error('spawn fake-python ENOENT'));
    assert.equal(worker.state().consecutiveFailures, 2);
    assert.equal(worker.state().restarting, true);

    worker.stop();
});

test('restart delays grow exponentially from the base and cap at the maximum', () => {
    assert.equal(restartDelayMs(0, 1000, 60_000), 1000);
    assert.equal(restartDelayMs(1, 1000, 60_000), 1000);
    assert.equal(restartDelayMs(2, 1000, 60_000), 2000);
    assert.equal(restartDelayMs(3, 1000, 60_000), 4000);
    assert.equal(restartDelayMs(6, 1000, 60_000), 32_000);
    assert.equal(restartDelayMs(7, 1000, 60_000), 60_000);
    assert.equal(restartDelayMs(50, 1000, 60_000), 60_000);
});

test('a crash mid-request rejects the in-flight request immediately', async () => {
    const { worker, children } = createWorker();
    worker.start();

    const pendingResult = worker.sendRequest({ value: 1 }, 5_000);
    children[0].emit('close', 1);

    await assert.rejects(pendingResult, /Fake Python worker crashed/);
    assert.equal(worker.state().pendingRequests, 0);
    assert.equal(worker.state().restarting, true);
    worker.stop();
});

test("an 'error' followed by 'close' settles pending work exactly once", async () => {
    const failures = [];
    const { worker, children } = createWorker();
    worker.onExited = () => failures.push('exit');
    worker.start();

    const pendingResult = worker.sendRequest({ value: 1 }, 5_000);
    children[0].emit('error', new Error('boom'));
    children[0].emit('close', 1);

    await assert.rejects(pendingResult, /failed to start: boom/);
    assert.equal(failures.length, 1);
    assert.equal(worker.state().consecutiveFailures, 1);
    worker.stop();
});

test('a timeout clears the pending request', async () => {
    const { worker, children } = createWorker();
    worker.start();

    const pendingResult = worker.sendRequest({ value: 1 }, 15);
    assert.equal(worker.state().pendingRequests, 1);
    await assert.rejects(pendingResult, /Fake Python worker timeout/);
    assert.equal(worker.state().pendingRequests, 0);
    assert.equal(children.length, 1);
    worker.stop();
});

test('a response arriving after the timeout is ignored cleanly', async () => {
    const { worker, children } = createWorker();
    worker.start();
    const [child] = children;

    const pendingResult = worker.sendRequest({ value: 1 }, 10);
    const { requestId } = child.stdin.lastRequest();
    await assert.rejects(pendingResult, /timeout/);

    // The stale response must neither throw nor mark the worker healthy.
    worker.consecutiveFailures = 5;
    child.respond({ requestId, success: true });
    assert.equal(worker.state().consecutiveFailures, 5);
    assert.equal(worker.state().pendingRequests, 0);

    // The worker keeps serving new requests afterwards.
    const nextResult = worker.sendRequest({ value: 2 }, 5_000);
    child.respond({ requestId: child.stdin.lastRequest().requestId, success: true, value: 2 });
    assert.equal((await nextResult).value, 2);
    worker.stop();
});

test('a failed stdin write settles the request without waiting for the timeout', async () => {
    const { worker, children } = createWorker();
    worker.start();
    children[0].stdin.writeError = new Error('EPIPE');

    await assert.rejects(worker.sendRequest({ value: 1 }, 5_000), /Fake worker write failed: EPIPE/);
    assert.equal(worker.state().pendingRequests, 0);
    worker.stop();
});

test("a stdin 'error' event rejects every pending request", async () => {
    const { worker, children } = createWorker();
    worker.start();

    const first = worker.sendRequest({ value: 1 }, 5_000);
    const second = worker.sendRequest({ value: 2 }, 5_000);
    children[0].stdin.emit('error', new Error('EPIPE'));

    await assert.rejects(first, /Fake worker unavailable: EPIPE/);
    await assert.rejects(second, /Fake worker unavailable: EPIPE/);
    assert.equal(worker.state().pendingRequests, 0);
    worker.stop();
});

test('graceful stop kills the child, rejects pending work, and never restarts', async () => {
    const { worker, children } = createWorker();
    worker.start();

    const pendingResult = worker.sendRequest({ value: 1 }, 5_000);
    worker.stop();

    assert.equal(children[0].killed, true);
    await assert.rejects(pendingResult, /Python workers are shutting down/);

    // The close event that follows the kill must not schedule a respawn.
    children[0].emit('close', 0);
    await wait(30);
    assert.equal(children.length, 1);
    assert.equal(worker.state().restarting, false);
});

test('sendRequest fails fast when the worker has no process', async () => {
    const { worker } = createWorker();
    await assert.rejects(
        worker.sendRequest({ value: 1 }, 5_000),
        /Fake worker is not available\. Check the Python runtime and backend logs\./,
    );
});

test('surviving healthyAfterMs resets the failure counter', async () => {
    const { worker } = createWorker({ healthyAfterMs: 20 });
    worker.start();
    worker.consecutiveFailures = 3;
    await wait(50);
    assert.equal(worker.state().consecutiveFailures, 0);
    worker.stop();
});

test('round-trips newline-delimited JSON with a real child process', async () => {
    const script = 'process.stdin.setEncoding("utf8");'
        + 'let buffer = "";'
        + 'process.stdin.on("data", (chunk) => {'
        + '  buffer += chunk;'
        + '  let index;'
        + '  while ((index = buffer.indexOf("\\n")) >= 0) {'
        + '    const line = buffer.slice(0, index);'
        + '    buffer = buffer.slice(index + 1);'
        + '    if (!line.trim()) continue;'
        + '    const request = JSON.parse(line);'
        + '    process.stdout.write(JSON.stringify({ requestId: request.requestId, echoed: request.value }) + "\\n");'
        + '  }'
        + '});';
    const worker = new PersistentJsonWorker({
        name: 'Echo',
        command: process.execPath,
        args: ['-e', script],
        log: quietLog,
    });
    worker.start();
    try {
        const result = await worker.sendRequest({ value: 42 }, 10_000);
        assert.equal(result.echoed, 42);
        assert.equal(worker.state().pendingRequests, 0);
        assert.equal(worker.state().alive, true);
    } finally {
        worker.stop();
    }
    assert.equal(worker.state().alive, false);
});
