/**
 * Only two results are publishable, and both open the real screen the engineer
 * was looking at rather than a table built for the link. Anything else that
 * used to be shareable is deliberately gone.
 */
const SHARE_KINDS = Object.freeze([
    'ILI_ALIGNMENT',
    'FFS',
]);
const SHARE_KIND_SET = new Set(SHARE_KINDS);
const SHARE_EXPIRY_DAYS = new Set([7, 30, 90]);
// A full FFS assessment runs to tens of megabytes: the link freezes every
// feature, because that page persists nothing server-side and would otherwise
// have nothing to reopen. Keep this in step with MAX_SNAPSHOT_BYTES in
// publicShareSnapshot.ts, which fails the same size in the browser first.
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_SNAPSHOT_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_NOTES = 100;
const MAX_STATE_DEPTH = 12;
// Scaled with the byte ceiling. A node is roughly a JSON value, and the byte
// limit is the one that actually bounds the payload; this only stops a
// pathological structure from spending the walk before it gets there.
const MAX_STATE_NODES = 4_000_000;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value, field, maximum) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > maximum) {
        throw new Error(`${field} exceeds ${maximum} characters`);
    }
    return normalized;
}

function optionalText(value, field, maximum) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new Error(`${field} must be text`);
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maximum) {
        throw new Error(`${field} exceeds ${maximum} characters`);
    }
    return normalized;
}

function parseKind(value) {
    const kind = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!SHARE_KIND_SET.has(kind)) {
        throw new Error(`kind must be one of: ${SHARE_KINDS.join(', ')}`);
    }
    return kind;
}

function parseSummary(summary) {
    if (summary === undefined) return [];
    if (!Array.isArray(summary) || summary.length > 50) {
        throw new Error('snapshot.summary must be an array with at most 50 entries');
    }
    return summary.map((item, index) => {
        if (!isRecord(item)) throw new Error(`snapshot.summary[${index}] must be an object`);
        const value = item.value;
        const validValue = value === null
            || typeof value === 'string'
            || typeof value === 'boolean'
            || (typeof value === 'number' && Number.isFinite(value));
        if (!validValue) throw new Error(`snapshot.summary[${index}].value is invalid`);
        return {
            label: requiredText(item.label, `snapshot.summary[${index}].label`, 80),
            value,
            ...(item.tone === undefined
                ? {}
                : { tone: optionalText(item.tone, `snapshot.summary[${index}].tone`, 30) }),
        };
    });
}

function parseColumns(columns) {
    // Both publishable kinds render their own screen from `state`, so a column
    // list is optional; it is still accepted and bounded for older callers.
    if (columns === undefined) return [];
    if (!Array.isArray(columns) || columns.length > MAX_COLUMNS) {
        throw new Error(`snapshot.columns must contain at most ${MAX_COLUMNS} entries`);
    }
    const seen = new Set();
    return columns.map((column, index) => {
        if (!isRecord(column)) throw new Error(`snapshot.columns[${index}] must be an object`);
        const key = requiredText(column.key, `snapshot.columns[${index}].key`, 160);
        if (DANGEROUS_KEYS.has(key.toLowerCase())) {
            throw new Error(`snapshot column key "${key}" is not allowed`);
        }
        if (seen.has(key)) throw new Error(`snapshot column key "${key}" is duplicated`);
        seen.add(key);
        return {
            key,
            label: requiredText(column.label, `snapshot.columns[${index}].label`, 160),
        };
    });
}

function parseRows(rows) {
    if (rows === undefined) return [];
    if (!Array.isArray(rows)) throw new Error('snapshot.rows must be an array');
    if (rows.length > MAX_SNAPSHOT_ROWS) {
        throw new Error(`snapshot.rows exceeds ${MAX_SNAPSHOT_ROWS} entries`);
    }
    rows.forEach((row, index) => {
        if (!isRecord(row)) throw new Error(`snapshot.rows[${index}] must be an object`);
    });
    return rows;
}

function parseNotes(notes) {
    if (notes === undefined) return [];
    if (!Array.isArray(notes) || notes.length > MAX_NOTES) {
        throw new Error(`snapshot.notes must be an array with at most ${MAX_NOTES} entries`);
    }
    return notes.map((note, index) => requiredText(note, `snapshot.notes[${index}]`, 500));
}

/**
 * The frozen screen state, copied through as plain JSON.
 *
 * Its shape belongs to the page that renders it, not to this contract, so it is
 * not field-checked here — but it is walked to strip prototype-polluting keys
 * and functions, and bounded in depth, node count and bytes so a published link
 * can never become an unbounded blob.
 */
function sanitizeState(value, depth = 0, budget = { nodes: 0 }) {
    budget.nodes += 1;
    if (budget.nodes > MAX_STATE_NODES) {
        throw new Error(`snapshot.state exceeds ${MAX_STATE_NODES} values`);
    }
    if (depth > MAX_STATE_DEPTH) {
        throw new Error(`snapshot.state is nested deeper than ${MAX_STATE_DEPTH} levels`);
    }
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((item) => sanitizeState(item, depth + 1, budget));
    if (!isRecord(value)) return null;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (DANGEROUS_KEYS.has(key.toLowerCase())) continue;
        if (typeof item === 'function' || item === undefined) continue;
        output[key] = sanitizeState(item, depth + 1, budget);
    }
    return output;
}

function parseState(value) {
    if (value === undefined || value === null) return null;
    if (!isRecord(value)) throw new Error('snapshot.state must be an object');
    return sanitizeState(value);
}

function parseSnapshot(value) {
    if (!isRecord(value)) throw new Error('snapshot must be an object');
    if (value.version !== 1) throw new Error('snapshot.version must be 1');

    const state = parseState(value.state);
    const snapshot = {
        version: 1,
        summary: parseSummary(value.summary),
        columns: parseColumns(value.columns),
        rows: parseRows(value.rows),
        notes: parseNotes(value.notes),
        ...(state === null ? {} : { state }),
    };
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
        throw new Error(`snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`);
    }
    return snapshot;
}

function parseCreateShare(body) {
    if (!isRecord(body)) throw new Error('request body must be an object');
    const expiresInDays = body.expiresInDays === undefined ? 30 : Number(body.expiresInDays);
    if (!SHARE_EXPIRY_DAYS.has(expiresInDays)) {
        throw new Error('expiresInDays must be one of: 7, 30, 90');
    }
    return {
        kind: parseKind(body.kind),
        title: requiredText(body.title, 'title', 160),
        sourceRef: optionalText(body.sourceRef, 'sourceRef', 200),
        expiresInDays,
        snapshot: parseSnapshot(body.snapshot),
    };
}

function parseShareFilters(query = {}) {
    return {
        kind: query.kind === undefined || query.kind === '' ? null : parseKind(query.kind),
        sourceRef: optionalText(query.sourceRef, 'sourceRef', 200),
    };
}

/**
 * Transport ceiling for a publish request, derived from the snapshot ceiling
 * rather than written down beside it: a body limit lower than the snapshot
 * limit rejects the upload before the contract can explain why, and the two
 * drifting apart is exactly the failure that produces a bare 413.
 *
 * The margin covers the request envelope and JSON escaping, which can inflate
 * a snapshot noticeably when it is full of quoted strings.
 */
const PUBLIC_SHARE_BODY_LIMIT = `${Math.ceil((MAX_SNAPSHOT_BYTES / (1024 * 1024)) * 1.1)}mb`;

module.exports = {
    MAX_SNAPSHOT_BYTES,
    MAX_SNAPSHOT_ROWS,
    PUBLIC_SHARE_BODY_LIMIT,
    SHARE_KINDS,
    parseCreateShare,
    parseShareFilters,
    parseSnapshot,
};
