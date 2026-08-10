const path = require('path');
const { spawn } = require('child_process');
const { pythonExecutable, pythonSpawnOptions, killPythonProcess } = require('../../config/python');

const GENERATOR_SCRIPT = 'src/python_engines/gw_distance_generator.py';
const ENGINE_CWD = path.join(__dirname, '../../..');

// One pass over a run's features and, on apply, one batched write. Generous
// enough for a 200k-feature run on a cold connection, bounded so a wedged
// process cannot hold the request open indefinitely.
function generatorTimeoutMs(env = process.env) {
    const configured = Number(env.GW_DISTANCE_GENERATOR_TIMEOUT_MS);
    if (Number.isFinite(configured) && configured > 0) return configured;
    return 5 * 60 * 1000;
}

/**
 * Confirm the run belongs to the caller's organization before the generator
 * touches it.
 *
 * The generator writes to `ili_features`, so an unchecked run id would let one
 * tenant rewrite another's ingested survey. `survey_runs` carries no
 * organization of its own; ownership comes through the pipeline, exactly as the
 * alignment worker resolves it.
 */
async function findOwnedRun(pool, runId, organizationId) {
    const result = await pool.query(
        `SELECT r.id, r.survey_year, r.source_file, r.row_count
         FROM survey_runs r
         JOIN pipelines p ON p.id = r.pipeline_id
         WHERE r.id = $1 AND p.organization_id = $2`,
        [runId, organizationId],
    );
    return result.rows[0] || null;
}

/** The generator's last recorded pass over this run, or null if it never ran. */
async function findGenerationRecord(pool, runId) {
    const result = await pool.query(
        `SELECT run_id, generated_at, girth_welds, derived_count,
                no_upstream_weld_count, unreadable_distance_count,
                vendor_reported_count, feature_count, median_joint_length_m
         FROM run_gw_distance_generation
         WHERE run_id = $1`,
        [runId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
        runId: row.run_id,
        generatedAt: row.generated_at,
        girthWelds: row.girth_welds,
        derivedCount: row.derived_count,
        noUpstreamWeldCount: row.no_upstream_weld_count,
        unreadableDistanceCount: row.unreadable_distance_count,
        vendorReportedCount: row.vendor_reported_count,
        featureCount: row.feature_count,
        medianJointLengthM: row.median_joint_length_m,
    };
}

/**
 * Run the generator over one run.
 *
 * `apply: false` computes and returns without writing anything — and computes it
 * with the very same pass that applying would use, which is what makes the
 * preview worth reading rather than a second guess at the same question.
 */
function runGwDistanceGenerator(runId, { apply = false, generatedBy = null } = {}) {
    return new Promise((resolve, reject) => {
        const args = [GENERATOR_SCRIPT, String(runId)];
        if (apply) args.push('--apply');
        if (generatedBy) args.push('--generated-by', String(generatedBy));

        const child = spawn(pythonExecutable, args, pythonSpawnOptions({ cwd: ENGINE_CWD }));
        let stdout = '';
        let stderr = '';
        const timeoutMs = generatorTimeoutMs();
        const timeout = setTimeout(() => {
            killPythonProcess(child);
            const error = new Error(`GW distance generation exceeded ${timeoutMs} ms`);
            error.code = 'GW_GENERATION_TIMEOUT';
            reject(error);
        }, timeoutMs);

        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => { clearTimeout(timeout); reject(error); });
        child.on('close', (code) => {
            clearTimeout(timeout);
            let payload = null;
            try {
                payload = JSON.parse(stdout.trim().split('\n').pop() || 'null');
            } catch (_error) {
                payload = null;
            }
            if (code !== 0) {
                // The script reports its own refusals as JSON (no such run, no
                // girth welds); anything else is a crash and keeps its stderr.
                const error = new Error(payload?.error || stderr || `Generator exited with ${code}`);
                error.code = payload?.error ? 'GW_GENERATION_REJECTED' : 'GW_GENERATION_FAILED';
                return reject(error);
            }
            if (!payload) {
                const error = new Error('Generator produced no readable result');
                error.code = 'GW_GENERATION_FAILED';
                return reject(error);
            }
            return resolve(payload);
        });
    });
}

module.exports = {
    findGenerationRecord,
    findOwnedRun,
    generatorTimeoutMs,
    runGwDistanceGenerator,
};
