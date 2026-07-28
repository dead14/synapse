const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const { once } = require('events');
const { finished } = require('stream/promises');
const readline = require('readline');
const { randomUUID } = require('crypto');
const { pythonExecutable, pythonSpawnOptions, killPythonProcess } = require('../../config/python');

// Each export spawns a Python process and writes a temp file, so an
// authenticated client looping this endpoint could otherwise spawn unbounded
// interpreters and fill uploads/.  Cap how many can run at once.
const MAX_CONCURRENT_EXPORTS = Number(process.env.MAX_CONCURRENT_EXPORTS) || 3;
const EXPORT_PROCESS_TIMEOUT_MS = Number(process.env.EXPORT_PROCESS_TIMEOUT_MS) || 10 * 60 * 1000;
const MAX_EXPORT_STDERR_BYTES = 64 * 1024;
let activeExports = 0;

function exportError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function removeQuietly(filePath) {
    await fsPromises.rm(filePath, { force: true }).catch(() => {});
}

async function spoolExportRows({
    rows,
    rowsPath,
    metadataPath,
    pipelineData,
    maxRows,
    onProgress,
}) {
    const writer = fs.createWriteStream(rowsPath, { encoding: 'utf8' });
    let streamError = null;
    writer.on('error', (error) => { streamError = error; });
    const headers = [];
    const seenHeaders = new Set();
    let rowCount = 0;

    try {
        for await (const sourceRow of rows) {
            if (streamError) throw streamError;
            if (!sourceRow || typeof sourceRow !== 'object' || Array.isArray(sourceRow)) {
                throw exportError('Stored alignment result contains an invalid row', 'EXPORT_FAILED');
            }
            rowCount += 1;
            if (rowCount > maxRows) {
                throw exportError(
                    `Export is limited to ${maxRows} rows per sheet`,
                    'EXPORT_TOO_LARGE',
                );
            }

            const row = {};
            for (const [key, value] of Object.entries(sourceRow)) {
                if (key.startsWith('__')) continue;
                row[key] = value;
                if (!seenHeaders.has(key)) {
                    seenHeaders.add(key);
                    headers.push(key);
                }
            }
            if (!writer.write(`${JSON.stringify(row)}\n`)) {
                await once(writer, 'drain');
            }
            if (rowCount % 10_000 === 0) {
                onProgress?.({ stage: 'spooling', rowCount });
            }
        }
        if (streamError) throw streamError;
        writer.end();
        await finished(writer);
    } catch (error) {
        writer.destroy();
        await finished(writer).catch(() => {});
        throw error;
    }

    await fsPromises.writeFile(metadataPath, JSON.stringify({
        pipelineData,
        headers,
        rowCount,
    }));
    onProgress?.({ stage: 'spooling', rowCount });
    return { headers, rowCount };
}

async function runPythonExport(engineArguments, outputPath, onProgress) {
    await new Promise((resolve, reject) => {
        const pythonProcess = spawn(
            pythonExecutable,
            [
                path.join(__dirname, '../../python_engines/export_excel.py'),
                ...engineArguments,
            ],
            pythonSpawnOptions(),
        );
        const outputLines = readline.createInterface({ input: pythonProcess.stdout });
        outputLines.on('line', (line) => {
            const match = /^PROGRESS\s+(\d+)$/.exec(line.trim());
            if (match) onProgress?.(Number(match[1]));
        });

        const errorChunks = [];
        let errorBytes = 0;
        pythonProcess.stderr.on('data', (chunk) => {
            if (errorBytes >= MAX_EXPORT_STDERR_BYTES) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const captured = buffer.subarray(
                0,
                MAX_EXPORT_STDERR_BYTES - errorBytes,
            );
            errorChunks.push(captured);
            errorBytes += captured.length;
        });

        let settled = false;
        const settle = (finish, value) => {
            if (settled) return;
            settled = true;
            finish(value);
        };

        const timeout = setTimeout(() => {
            killPythonProcess(pythonProcess);
            settle(reject, exportError('Excel export timed out', 'EXPORT_TIMEOUT'));
        }, EXPORT_PROCESS_TIMEOUT_MS);

        pythonProcess.on('error', (error) => {
            clearTimeout(timeout);
            console.error('Excel export failed to spawn:', error.message);
            settle(reject, exportError('Failed to generate Excel file', 'EXPORT_FAILED'));
        });

        pythonProcess.on('close', (code) => {
            clearTimeout(timeout);
            (async () => {
                const produced = code === 0 && await fsPromises
                    .access(outputPath)
                    .then(() => true, () => false);
                if (produced) {
                    settle(resolve);
                    return;
                }
                const errorOutput = Buffer.concat(errorChunks).toString('utf8');
                console.error('Excel export python failed:', errorOutput);
                settle(reject, exportError('Failed to generate Excel file', 'EXPORT_FAILED'));
            })();
        });
    });
}

async function generateExcelExport(prepareEngineArguments, { onWorkbookProgress } = {}) {
    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
        throw exportError('Too many exports in progress. Retry shortly.', 'EXPORT_BUSY');
    }
    activeExports += 1;

    const uploadsDir = path.join(__dirname, '../../../../uploads');
    const exportId = randomUUID();
    const tempInputFile = path.join(uploadsDir, `export_input_${exportId}.json`);
    const tempRowsFile = path.join(uploadsDir, `export_rows_${exportId}.ndjson`);
    const tempMetadataFile = path.join(uploadsDir, `export_metadata_${exportId}.json`);
    const tempOutputFile = path.join(uploadsDir, `export_output_${exportId}.xlsx`);

    let slotReleased = false;
    const releaseSlot = () => {
        if (slotReleased) return;
        slotReleased = true;
        activeExports -= 1;
    };

    let outputReleased = false;
    const release = async () => {
        if (outputReleased) return;
        outputReleased = true;
        await removeQuietly(tempOutputFile);
    };

    try {
        await fsPromises.mkdir(uploadsDir, { recursive: true });
        const engineArguments = await prepareEngineArguments({
            tempInputFile,
            tempRowsFile,
            tempMetadataFile,
            tempOutputFile,
        });
        await runPythonExport(engineArguments, tempOutputFile, onWorkbookProgress);
        return { filePath: tempOutputFile, release };
    } catch (error) {
        await release();
        throw error;
    } finally {
        // Only workbook generation consumes a concurrency slot. Ready files
        // are bounded separately by the export job registry.
        releaseSlot();
        await Promise.all([
            removeQuietly(tempInputFile),
            removeQuietly(tempRowsFile),
            removeQuietly(tempMetadataFile),
        ]);
    }
}

/**
 * Runs export_excel.py over the rows and resolves with the produced file.
 *
 * The caller streams `filePath` to the client and MUST call `release()`
 * afterwards to remove the temporary workbook. The generation slot is released
 * after Python exits; retained job limits protect the output directory during
 * extraction.  Failures are thrown as typed errors — EXPORT_BUSY,
 * EXPORT_TIMEOUT, EXPORT_FAILED — and clean up their own temp files.
 */
async function createExcelExport(data) {
    return generateExcelExport(async ({ tempInputFile, tempOutputFile }) => {
        // Async, and without the pretty-printing that tripled the bytes
        // written for a 100k-row export.
        await fsPromises.writeFile(tempInputFile, JSON.stringify(data));
        return [tempInputFile, tempOutputFile];
    });
}

async function createSessionExcelExport({
    rows,
    pipelineData,
    maxRows,
    onProgress,
}) {
    return generateExcelExport(async ({
        tempRowsFile,
        tempMetadataFile,
        tempOutputFile,
    }) => {
        await spoolExportRows({
            rows,
            rowsPath: tempRowsFile,
            metadataPath: tempMetadataFile,
            pipelineData,
            maxRows,
            onProgress,
        });
        onProgress?.({ stage: 'workbook', rowCount: 0 });
        return [
            '--ndjson',
            tempMetadataFile,
            tempRowsFile,
            tempOutputFile,
        ];
    }, {
        onWorkbookProgress: (rowCount) => {
            onProgress?.({ stage: 'workbook', rowCount });
        },
    });
}

module.exports = {
    MAX_CONCURRENT_EXPORTS,
    createExcelExport,
    createSessionExcelExport,
    spoolExportRows,
};
