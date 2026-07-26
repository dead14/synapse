/**
 * Admission control for one Python engine: a fixed pool of persistent
 * workers, each strictly serial, in front of a bounded FIFO queue.
 *
 * Dispatch picks the available worker with the fewest pending requests,
 * breaking ties round-robin.  When every worker is at its in-flight cap,
 * requests wait in the queue; when the queue is full they are rejected
 * immediately with a typed ENGINE_BUSY error the HTTP layer maps to 429
 * (mirroring the Excel export concurrency cap).  A queued request carries
 * the same timeout budget as an executing one, so a wedged engine expels
 * its backlog instead of growing it without bound.
 */
class PythonWorkerPool {
    constructor({
        name,
        size,
        createWorker,
        maxInFlightPerWorker = 1,
        queueMax = 20,
        defaultTimeoutMs = 60_000,
        messages = {},
    }) {
        this.name = name;
        this.maxInFlightPerWorker = maxInFlightPerWorker;
        this.queueMax = queueMax;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.messages = {
            unavailable: `${name} worker is not available. Check the Python runtime and backend logs.`,
            timeout: `${name} Python worker timeout`,
            busy: `Too many ${name} requests in progress. Retry shortly.`,
            shutdown: 'Python workers are shutting down',
            ...messages,
        };
        this.queue = [];
        this.cursor = 0;
        this.stopped = false;
        this.workers = Array.from({ length: size }, (_unused, index) => {
            const worker = createWorker(index);
            worker.onStarted = () => this.pump();
            worker.onSettled = () => this.pump();
            worker.onExited = () => this.handleWorkerExit();
            return worker;
        });
    }

    start() {
        if (this.stopped) return;
        for (const worker of this.workers) worker.start();
    }

    stop() {
        this.stopped = true;
        this.flushQueue(new Error(this.messages.shutdown));
        for (const worker of this.workers) worker.stop();
    }

    sendRequest(payload, timeoutMs = this.defaultTimeoutMs) {
        if (this.stopped) {
            return Promise.reject(new Error(this.messages.shutdown));
        }
        const worker = this.pickWorker();
        if (worker) return worker.sendRequest(payload, timeoutMs);

        // No worker can even receive a write: fail fast exactly like the
        // single-worker code did, rather than parking requests behind a
        // restart that may be a minute away.
        if (!this.workers.some((candidate) => candidate.isWritable())) {
            return Promise.reject(new Error(this.messages.unavailable));
        }

        if (this.queue.length >= this.queueMax) {
            const error = new Error(this.messages.busy);
            error.code = 'ENGINE_BUSY';
            return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
            const entry = { payload, timeoutMs, resolve, reject, timer: null };
            entry.timer = setTimeout(() => {
                this.removeQueued(entry, new Error(this.messages.timeout));
            }, timeoutMs);
            this.queue.push(entry);
        });
    }

    // The available worker with the fewest pending requests, ties broken
    // round-robin from a rotating cursor.  With the default in-flight cap of
    // 1 this is strict round-robin across idle workers.
    pickWorker() {
        let best = null;
        let bestIndex = -1;
        for (let offset = 0; offset < this.workers.length; offset += 1) {
            const index = (this.cursor + offset) % this.workers.length;
            const worker = this.workers[index];
            if (!worker.isAvailable(this.maxInFlightPerWorker)) continue;
            if (!best || worker.pendingCount() < best.pendingCount()) {
                best = worker;
                bestIndex = index;
            }
        }
        if (best) this.cursor = (bestIndex + 1) % this.workers.length;
        return best;
    }

    pump() {
        while (this.queue.length > 0) {
            const worker = this.pickWorker();
            if (!worker) break;
            const entry = this.queue.shift();
            clearTimeout(entry.timer);
            worker.sendRequest(entry.payload, entry.timeoutMs).then(entry.resolve, entry.reject);
        }
    }

    handleWorkerExit() {
        // The dead worker's in-flight requests were already rejected.  Queued
        // requests only keep waiting while some worker can still take them;
        // once none can, fail them the way a direct request would fail.
        if (!this.workers.some((worker) => worker.isWritable())) {
            this.flushQueue(new Error(this.messages.unavailable));
        }
    }

    removeQueued(entry, error) {
        const index = this.queue.indexOf(entry);
        if (index === -1) return;
        this.queue.splice(index, 1);
        clearTimeout(entry.timer);
        entry.reject(error);
    }

    flushQueue(error) {
        while (this.queue.length > 0) {
            const entry = this.queue.shift();
            clearTimeout(entry.timer);
            entry.reject(error);
        }
    }

    // Aggregate readiness state.  `alive` demands every pool member so a
    // crash-looping member degrades readiness exactly as the single worker
    // used to; per-member detail rides along for diagnosis.
    state() {
        const workers = this.workers.map((worker) => worker.state());
        return {
            alive: workers.length > 0 && workers.every((worker) => worker.alive),
            restarting: workers.some((worker) => worker.restarting),
            consecutiveFailures: workers.reduce(
                (max, worker) => Math.max(max, worker.consecutiveFailures),
                0,
            ),
            pendingRequests: workers.reduce((sum, worker) => sum + worker.pendingRequests, 0),
            queuedRequests: this.queue.length,
            poolSize: workers.length,
            workers,
        };
    }
}

module.exports = { PythonWorkerPool };
