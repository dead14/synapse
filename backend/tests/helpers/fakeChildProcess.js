const { EventEmitter } = require('node:events');

// A scripted stand-in for a spawned Python engine: enough of the
// ChildProcess surface for PersistentJsonWorker — stdio emitters, a stdin
// that records writes (and can fail them), kill/killed/exitCode.
class FakeStdin extends EventEmitter {
    constructor() {
        super();
        this.writable = true;
        this.writes = [];
        this.writeError = null;
    }

    write(chunk, callback) {
        this.writes.push(chunk);
        if (callback) callback(this.writeError);
        return true;
    }

    lastRequest() {
        return JSON.parse(this.writes[this.writes.length - 1]);
    }
}

class FakeChildProcess extends EventEmitter {
    constructor() {
        super();
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.stdin = new FakeStdin();
        this.killed = false;
        this.exitCode = null;
    }

    kill() {
        this.killed = true;
    }

    // A real ChildProcess has its exitCode populated by the time 'close'
    // fires; mirror that so alive-ness checks behave like production.
    emit(event, ...args) {
        if (event === 'close' && this.exitCode === null) {
            this.exitCode = typeof args[0] === 'number' ? args[0] : 0;
        }
        return super.emit(event, ...args);
    }

    respond(result) {
        this.stdout.emit('data', Buffer.from(JSON.stringify(result) + '\n'));
    }
}

const quietLog = { log: () => {}, error: () => {} };

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { FakeChildProcess, FakeStdin, quietLog, wait };
