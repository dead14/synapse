const SHARE_KINDS = Object.freeze([
    'GW_ALIGNMENT',
    'SECTIONING',
    'ILI_ALIGNMENT',
    'CORROSION',
    'FFS',
]);
const SHARE_KIND_SET = new Set(SHARE_KINDS);
const SHARE_EXPIRY_DAYS = new Set([7, 30, 90]);
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const MAX_SNAPSHOT_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_NOTES = 100;
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
    if (!Array.isArray(columns) || columns.length === 0 || columns.length > MAX_COLUMNS) {
        throw new Error(`snapshot.columns must contain 1-${MAX_COLUMNS} entries`);
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

function parseSnapshot(value) {
    if (!isRecord(value)) throw new Error('snapshot must be an object');
    if (value.version !== 1) throw new Error('snapshot.version must be 1');

    const snapshot = {
        version: 1,
        summary: parseSummary(value.summary),
        columns: parseColumns(value.columns),
        rows: parseRows(value.rows),
        notes: parseNotes(value.notes),
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

module.exports = {
    MAX_SNAPSHOT_BYTES,
    MAX_SNAPSHOT_ROWS,
    SHARE_KINDS,
    parseCreateShare,
    parseShareFilters,
    parseSnapshot,
};
