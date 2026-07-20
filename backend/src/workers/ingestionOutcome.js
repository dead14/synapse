function parseIngestionOutput(output) {
    const marked = output.match(/JSON_OUTPUT:(\{[^\r\n]+\})/);
    const raw = marked ? marked[1] : output.trim();
    const result = JSON.parse(raw);
    if (result.status !== 'success') throw new Error(result.message || 'Ingestion failed');
    return result;
}

function resolveIngestionExit({ code, output, errorOutput }) {
    if (code === 0) return parseIngestionOutput(output);

    try {
        parseIngestionOutput(output);
    } catch (error) {
        throw new Error(errorOutput || error.message || `Ingestion exited with code ${code}`);
    }

    throw new Error(errorOutput || `Ingestion exited with code ${code}`);
}

module.exports = { parseIngestionOutput, resolveIngestionExit };
