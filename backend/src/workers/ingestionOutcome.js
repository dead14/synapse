// Stderr is a diagnostic, not the operator-facing message; keep only enough
// of it to be useful in a job row or log line.
const STDERR_DIAGNOSTIC_LIMIT = 2000;

function parseIngestionOutput(output) {
    // Use the LAST marker: the importer prints its final structured status
    // last, and earlier output (progress logs, echoed input) may contain a
    // stale or partial JSON_OUTPUT line.
    let marked = null;
    for (const match of output.matchAll(/JSON_OUTPUT:(\{[^\r\n]+\})/g)) marked = match;
    const raw = marked ? marked[1] : output.trim();
    const result = JSON.parse(raw);
    if (result.status !== 'success') {
        const error = new Error(result.message || 'Ingestion failed');
        if (result.code) error.code = result.code;
        // Distinguishes an importer-reported failure from a JSON parse
        // failure, so exit handling can prefer this message over raw stderr.
        error.structured = true;
        throw error;
    }
    return result;
}

function resolveIngestionExit({ code, output, errorOutput }) {
    if (code === 0) return parseIngestionOutput(output);

    try {
        parseIngestionOutput(output);
    } catch (error) {
        if (error.structured) {
            // The importer explained the failure itself; raw stderr (usually
            // a traceback) must not overwrite that message. Keep it attached
            // as diagnostic detail instead.
            if (errorOutput) error.diagnostic = errorOutput.slice(0, STDERR_DIAGNOSTIC_LIMIT);
            throw error;
        }
        if (!errorOutput) throw error;
        const wrapped = new Error(errorOutput);
        if (error.code) wrapped.code = error.code;
        throw wrapped;
    }

    throw new Error(errorOutput || `Ingestion exited with code ${code}`);
}

module.exports = { parseIngestionOutput, resolveIngestionExit };
