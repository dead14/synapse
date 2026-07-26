const { spawn } = require('child_process');

// Restart backoff: a worker that dies on startup (bad PYTHON_EXECUTABLE,
// missing dependency) used to be respawned every 1000 ms forever.  Failures
// back off exponentially — 1s, 2s, 4s, ... capped — and the counter resets
// once a worker proves healthy, by surviving healthyAfterMs or completing a
// request.
function restartDelayMs(consecutiveFailures, baseDelayMs, maxDelayMs) {
    return Math.min(
        baseDelayMs * 2 ** Math.max(0, consecutiveFailures - 1),
        maxDelayMs,
    );
}

// Error text is API-visible (handlers surface err.message in 500 bodies), so
// engines that need the historical wording override these defaults.
function defaultMessages(name) {
    return {
        unavailable: `${name} worker is not available. Check the Python runtime and backend logs.`,
        timeout: `${name} Python worker timeout`,
        crashed: `${name} Python worker crashed`,
        shutdown: 'Python workers are shutting down',
    };
}

/**
 * One persistent child process speaking newline-delimited JSON over stdio.
 *
 * Encapsulates what the alignment controller used to duplicate per engine:
 * spawn, line-buffered stdout parsing keyed by requestId, a pending-request
 * map with per-request timeouts, stdin write/EPIPE handling, and an
 * exponential-backoff restart loop guarded so pending rejection and restart
 * scheduling happen exactly once per child.
 */
class PersistentJsonWorker {
    constructor({
        name,
        command,
        args,
        spawnOptions = {},
        spawnFn = spawn,
        restartBaseDelayMs = 1000,
        restartMaxDelayMs = 60_000,
        healthyAfterMs = 60_000,
        nextRequestId = null,
        messages = {},
        log = console,
    }) {
        this.name = name;
        this.command = command;
        this.args = args;
        this.spawnOptions = spawnOptions;
        this.spawnFn = spawnFn;
        this.restartBaseDelayMs = restartBaseDelayMs;
        this.restartMaxDelayMs = restartMaxDelayMs;
        this.healthyAfterMs = healthyAfterMs;
        this.messages = { ...defaultMessages(name), ...messages };
        this.log = log;

        this.child = null;
        this.pending = new Map();
        this.restartTimer = null;
        this.healthyTimer = null;
        this.consecutiveFailures = 0;
        this.stopped = false;

        this.requestCounter = 0;
        this.nextRequestId = nextRequestId
            || (() => { this.requestCounter += 1; return this.requestCounter; });

        // Assigned by the pool: a settled request or a fresh child means new
        // capacity, a dead child may mean queued work must fail fast.
        this.onStarted = null;
        this.onSettled = null;
        this.onExited = null;
    }

    start() {
        if (this.stopped || this.child) return;
        this.log.log(`Starting persistent ${this.name} Python worker...`);
        const options = typeof this.spawnOptions === 'function'
            ? this.spawnOptions()
            : this.spawnOptions;
        const child = this.spawnFn(this.command, this.args, options);
        this.child = child;
        this.armHealthyReset();

        let buffer = '';
        child.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const result = JSON.parse(line);
                    const pending = this.settlePending(result.requestId);
                    if (pending) {
                        // A completed round-trip proves the worker is healthy.
                        this.consecutiveFailures = 0;
                        pending.resolve(result);
                        this.onSettled?.(this);
                    }
                } catch (e) {
                    this.log.error(`Parse error from ${this.name} worker:`, line);
                }
            }
        });

        child.stderr.on('data', (data) => {
            this.log.error(`${this.name} Worker Stderr:`, data.toString());
        });

        // A worker that died mid-write surfaces EPIPE here; with no listener
        // that is an uncaught 'error' event.  Fail the in-flight requests
        // immediately instead of letting each wait out its full timeout.
        child.stdin.on('error', (error) => {
            this.log.error(`${this.name} worker stdin error:`, error.message);
            this.rejectAllPending(new Error(`${this.name} worker unavailable: ${error.message}`));
        });

        // 'error' (spawn failure such as an ENOENT interpreter) may arrive
        // without any 'close', and 'close' may follow an 'error'; route both
        // through one guard so pending rejection and restart scheduling
        // happen exactly once.
        let exitHandled = false;
        const handleWorkerExit = (failure) => {
            if (exitHandled || this.stopped) return;
            exitHandled = true;
            this.recordFailure();
            // Detach the dead child before rejecting: rejection callbacks can
            // pump a pool queue, which must not re-dispatch into this corpse.
            if (this.child === child) this.child = null;
            this.rejectAllPending(failure);
            this.scheduleRestart();
            this.onExited?.(this);
        };

        // Without this listener a spawn failure emits an unhandled 'error'
        // event, which becomes an uncaughtException and takes the whole API
        // process down in a supervisor crash-loop.
        child.on('error', (error) => {
            this.log.error(`${this.name} Python worker error:`, error.message);
            handleWorkerExit(new Error(`${this.name} Python worker failed to start: ${error.message}`));
        });

        child.on('close', (code) => {
            this.log.error(`${this.name} Python worker exited (code ${code}).`);
            handleWorkerExit(new Error(this.messages.crashed));
        });

        this.onStarted?.(this);
    }

    stop() {
        this.stopped = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (this.healthyTimer) {
            clearTimeout(this.healthyTimer);
            this.healthyTimer = null;
        }
        this.rejectAllPending(new Error(this.messages.shutdown));
        this.child?.kill();
    }

    sendRequest(payload, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (!this.isWritable()) {
                reject(new Error(this.messages.unavailable));
                return;
            }
            const requestId = this.nextRequestId();
            const timeout = setTimeout(() => {
                if (!this.pending.has(requestId)) return;
                this.pending.delete(requestId);
                this.log.error(`[${this.name}] Request ${requestId} timeout!`);
                reject(new Error(this.messages.timeout));
                this.onSettled?.(this);
            }, timeoutMs);
            this.pending.set(requestId, { resolve, reject, timeout });

            // A write into a dying worker (EPIPE) must fail this request now,
            // not after the full worker timeout.
            this.child.stdin.write(JSON.stringify({ ...payload, requestId }) + '\n', (error) => {
                if (!error) return;
                const pending = this.settlePending(requestId);
                if (pending) {
                    pending.reject(new Error(`${this.name} worker write failed: ${error.message}`));
                    this.onSettled?.(this);
                }
            });
        });
    }

    // Removes a pending request and clears its timeout so a settled request
    // never leaves a live timer behind.  A response arriving after its
    // timeout finds no pending entry and is ignored.
    settlePending(requestId) {
        const pending = this.pending.get(requestId);
        if (!pending) return null;
        this.pending.delete(requestId);
        clearTimeout(pending.timeout);
        return pending;
    }

    rejectAllPending(error) {
        if (this.pending.size === 0) return;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
        this.onSettled?.(this);
    }

    armHealthyReset() {
        if (this.healthyTimer) clearTimeout(this.healthyTimer);
        this.healthyTimer = setTimeout(() => {
            this.healthyTimer = null;
            this.consecutiveFailures = 0;
        }, this.healthyAfterMs);
        this.healthyTimer.unref?.();
    }

    recordFailure() {
        if (this.healthyTimer) {
            clearTimeout(this.healthyTimer);
            this.healthyTimer = null;
        }
        this.consecutiveFailures += 1;
    }

    scheduleRestart() {
        if (this.stopped || this.restartTimer) return;
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (!this.stopped) this.start();
        }, restartDelayMs(this.consecutiveFailures, this.restartBaseDelayMs, this.restartMaxDelayMs));
    }

    isAlive() {
        return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
    }

    isWritable() {
        return Boolean(this.child && !this.child.killed && this.child.stdin?.writable);
    }

    isAvailable(maxInFlight) {
        return this.isAlive() && this.isWritable() && this.pending.size < maxInFlight;
    }

    pendingCount() {
        return this.pending.size;
    }

    // Readiness detail for the health endpoint: state only, never process
    // handles.
    state() {
        return {
            alive: this.isAlive(),
            restarting: Boolean(this.restartTimer),
            consecutiveFailures: this.consecutiveFailures,
            pendingRequests: this.pending.size,
        };
    }
}

module.exports = { PersistentJsonWorker, restartDelayMs };
