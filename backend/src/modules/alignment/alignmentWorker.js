const { Queue, Worker } = require('bullmq');
const { connection } = require('../../config/redis');
const { spawn } = require('child_process');

const alignmentQueue = new Queue('alignmentQueue', { connection });

// Generic python runner function
const runPythonScript = (scriptName, args = [], inputData = null) => {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', [scriptName, ...args]);
        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
            console.error(`[${scriptName}] Error: ${data}`);
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const firstBrace = output.indexOf('{');
                    const lastBrace = output.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                        const jsonStr = output.substring(firstBrace, lastBrace + 1);
                        const result = JSON.parse(jsonStr);
                        resolve(result);
                    } else {
                        reject(new Error('No JSON result found from python engine. Raw: ' + output));
                    }
                } catch (err) {
                    reject(new Error('Failed to parse python engine output. Raw: ' + output));
                }
            } else {
                reject(new Error(`Python engine failed with code ${code}. Details: ${errorOutput}`));
            }
        });

        if (inputData) {
            pythonProcess.stdin.write(inputData);
            pythonProcess.stdin.end();
        }
    });
};

const alignmentWorker = new Worker('alignmentQueue', async (job) => {
    console.log(`Processing job ${job.id} of type ${job.name}`);
    
    // We can simulate progress if needed or just wait for the python script
    await job.updateProgress(10);
    
    let result;
    if (job.name === 'run-dtw') {
        const payload = job.data;
        result = await runPythonScript('dtw_engine.py', [], JSON.stringify(payload));
    } else if (job.name === 'run-hungarian') {
        const config = job.data;
        result = await runPythonScript('hungarian_engine.py', [], JSON.stringify(config));
    } else if (job.name === 'run-alignment') {
        const { runId, algorithm } = job.data;
        result = await runPythonScript('alignment_engine.py', [runId.toString(), algorithm], null);
    } else {
        throw new Error(`Unknown job type: ${job.name}`);
    }
    
    await job.updateProgress(100);
    return result;
}, { connection });

alignmentWorker.on('completed', (job) => {
    console.log(`Job ${job.id} completed!`);
});

alignmentWorker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed with error:`, err);
});

module.exports = {
    alignmentWorker,
    alignmentQueue
};
