function parseIngestionOutput(output) {
    const marked = output.match(/JSON_OUTPUT:(\{[^\r\n]+\})/);
    const raw = marked ? marked[1] : output.trim();
    const result = JSON.parse(raw);
    if (result.status !== 'success') {
        const error = new Error(result.message || 'Ingestion failed');
        if (result.code) error.code = result.code;
        throw error;
    }
    return result;
}

function resolveIngestionExit({ code, output, errorOutput }) {
    if (code === 0) return parseIngestionOutput(output);

    try {
        parseIngestionOutput(output);
    } catch (error) {
        if (!errorOutput) throw error;
        const wrapped = new Error(errorOutput);
        if (error.code) wrapped.code = error.code;
        throw wrapped;
    }

    throw new Error(errorOutput || `Ingestion exited with code ${code}`);
}

module.exports = { parseIngestionOutput, resolveIngestionExit };
