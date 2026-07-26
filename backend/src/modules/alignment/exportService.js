const { spawn } = require('child_process');
const path = require('path');
const fsPromises = require('fs').promises;
const { randomUUID } = require('crypto');
const { pythonExecutable, pythonSpawnOptions, killPythonProcess } = require('../../config/python');

// Each export spawns a Python process and writes a temp file, so an
// authenticated client looping this endpoint could otherwise spawn unbounded
// interpreters and fill uploads/.  Cap how many can run at once.
const MAX_CONCURRENT_EXPORTS = Number(process.env.MAX_CONCURRENT_EXPORTS) || 3;
const EXPORT_PROCESS_TIMEOUT_MS = Number(process.env.EXPORT_PROCESS_TIMEOUT_MS) || 2 * 60 * 1000;
let activeExports = 0;

function exportError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function removeQuietly(filePath) {
    await fsPromises.rm(filePath, { force: true }).catch(() => {});
}

/**
 * Runs export_excel.py over the rows and resolves with the produced file.
 *
 * The caller streams `filePath` to the client and MUST call `release()`
 * afterwards: the concurrency slot is held until release so a slow download
 * still counts against MAX_CONCURRENT_EXPORTS, exactly as before the
 * extraction.  Failures are thrown as typed errors — EXPORT_BUSY,
 * EXPORT_TIMEOUT, EXPORT_FAILED — and clean up their own temp files.
 */
async function createExcelExport(data) {
    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
        throw exportError('Too many exports in progress. Retry shortly.', 'EXPORT_BUSY');
    }
    activeExports += 1;

    const uploadsDir = path.join(__dirname, '../../../../uploads');
    const exportId = randomUUID();
    const tempInputFile = path.join(uploadsDir, `export_input_${exportId}.json`);
    const tempOutputFile = path.join(uploadsDir, `export_output_${exportId}.xlsx`);

    let released = false;
    const release = async () => {
        if (released) return;
        released = true;
        await removeQuietly(tempOutputFile);
        activeExports -= 1;
    };

    try {
        await fsPromises.mkdir(uploadsDir, { recursive: true });
        // Async, and without the pretty-printing that tripled the bytes
        // written for a 100k-row export.
        await fsPromises.writeFile(tempInputFile, JSON.stringify(data));

        await new Promise((resolve, reject) => {
            const pythonProcess = spawn(
                pythonExecutable,
                [
                    path.join(__dirname, '../../python_engines/export_excel.py'),
                    tempInputFile,
                    tempOutputFile,
                ],
                pythonSpawnOptions(),
            );

            let errorOutput = '';
            pythonProcess.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });

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

            // 'error' is emitted asynchronously (e.g. the interpreter is not
            // on PATH).  With no listener it becomes an uncaught exception,
            // the request hangs until the client times out, and the temp
            // file leaks.
            pythonProcess.on('error', (error) => {
                clearTimeout(timeout);
                console.error('Excel export failed to spawn:', error.message);
                settle(reject, exportError('Failed to generate Excel file', 'EXPORT_FAILED'));
            });

            pythonProcess.on('close', (code) => {
                clearTimeout(timeout);
                (async () => {
                    const produced = code === 0 && await fsPromises
                        .access(tempOutputFile)
                        .then(() => true, () => false);
                    if (produced) {
                        settle(resolve);
                        return;
                    }
                    console.error('Excel export python failed:', errorOutput);
                    settle(reject, exportError('Failed to generate Excel file', 'EXPORT_FAILED'));
                })();
            });
        });

        return { filePath: tempOutputFile, release };
    } catch (error) {
        await release();
        throw error;
    } finally {
        await removeQuietly(tempInputFile);
    }
}

module.exports = { MAX_CONCURRENT_EXPORTS, createExcelExport };
