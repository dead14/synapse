const DEFAULT_TTL_MS = 60 * 60 * 1000;

class OwnedJobStore {
    constructor({ ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
        this.jobs = new Map();
        this.ttlMs = ttlMs;
        this.now = now;
    }

    create(id, owner, initial = {}) {
        if (!id || owner?.userId == null || owner?.orgId == null) {
            throw new TypeError('Job id, userId, and orgId are required');
        }

        const timestamp = this.now();
        const job = {
            id,
            userId: Number(owner.userId),
            orgId: Number(owner.orgId),
            state: 'active',
            progress: 0,
            returnvalue: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            expiresAt: timestamp + this.ttlMs,
            ...initial,
        };
        this.jobs.set(id, job);
        return job;
    }

    update(id, patch) {
        const current = this.getInternal(id);
        if (!current) return null;

        const timestamp = this.now();
        const next = {
            ...current,
            ...patch,
            id: current.id,
            userId: current.userId,
            orgId: current.orgId,
            updatedAt: timestamp,
            expiresAt: timestamp + this.ttlMs,
        };
        this.jobs.set(id, next);
        return next;
    }

    getInternal(id) {
        const job = this.jobs.get(id);
        if (!job) return null;
        if (job.expiresAt <= this.now()) {
            this.jobs.delete(id);
            return null;
        }
        return job;
    }

    getForPrincipal(id, principal) {
        const job = this.getInternal(id);
        if (!job || !principal) return null;
        if (principal.role === 'super_admin') return job;
        if (Number(principal.orgId) !== job.orgId) return null;
        if (principal.role === 'admin') return job;
        return Number(principal.id) === job.userId ? job : null;
    }

    prune() {
        for (const id of this.jobs.keys()) this.getInternal(id);
    }

    get size() {
        this.prune();
        return this.jobs.size;
    }
}

module.exports = { OwnedJobStore, DEFAULT_TTL_MS };
