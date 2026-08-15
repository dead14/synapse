const metrics = require('../../observability/metrics');
const { comparisonRowDistance } = require('./alignmentContract');
// Server-authored session fields a wizard snapshot never carries.  They are the
// same fields the config fingerprint ignores, for the same reason: the client
// does not own them.
const { RUNTIME_CONFIG_FIELDS } = require('./alignmentExecution');

// Kept in step with COMPARISON_DISTANCE_KEYS in alignmentContract: the export
// cursor must order rows exactly the way the stored comparison array is ordered.
// These are literals, never user input — they are interpolated into SQL and must
// stay that way.  Only the legacy read path still needs them: rows written to
// alignment_job_rows carry a resolved sort_distance column instead.
const EXPORT_DISTANCE_KEYS = Object.freeze([
    'Log Dist NEW (m)',
    'Abs. Dist NEW (m)',
    'Log Dist OLD (m)',
    'Abs. Dist OLD (m)',
]);
/** Optional sign, digits, optional fraction — anything else is not a distance. */
const NUMERIC_TEXT_PATTERN = '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$';

/** How many result rows one INSERT carries. Bounded so the statement stays sane. */
const RESULT_ROW_INSERT_BATCH = 1_000;

function toJson(value) {
    return JSON.stringify(value ?? {});
}

/**
 * The two persisted runs a session config points at.
 *
 * `run_old_id` / `run_new_id` are declared columns that nothing ever wrote, so
 * the inspection registry's `WHERE s.run_old_id = sr.id OR s.run_new_id = sr.id`
 * matched nothing and every uploaded run reported no workflow stage. They are
 * derived from the config on each save rather than trusted from the client.
 */
function sessionRunReferences(config) {
    const parseId = (value) => {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const summary = config?.summaryData || {};
    const pairs = Array.isArray(summary.runPairs) ? summary.runPairs : [];
    // A chain session has no single pair; its first and last runs are the ends
    // of the chain, which is what the registry needs to link both to it.
    const oldRunId = parseId(summary.oldRun?.runId ?? pairs[0]?.oldRun?.runId);
    const newRunId = parseId(summary.newRun?.runId ?? pairs[pairs.length - 1]?.newRun?.runId);
    return { oldRunId, newRunId };
}

async function findOwnedSession(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT s.id, s.pipeline_id, s.started_at, s.completed_at, s.status, s.params_json,
                s.xmin::text AS revision,
                s.organization_id, s.created_by
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE s.id = $1
           AND COALESCE(s.organization_id, p.organization_id) = $2`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function findLatestOwnedSession(pool, orgId, { requireData = false, status = null } = {}) {
    const values = [orgId];
    const filters = ['COALESCE(s.organization_id, p.organization_id) = $1'];
    if (requireData) {
        filters.push("s.params_json IS NOT NULL", "s.params_json::text != 'null'");
    }
    if (status) {
        values.push(status);
        filters.push(`s.status = $${values.length}`);
    }

    const result = await pool.query(
        `SELECT s.id, s.pipeline_id, s.started_at, s.completed_at, s.status, s.params_json,
                s.xmin::text AS revision,
                s.organization_id, s.created_by
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE ${filters.join('\n           AND ')}
         ORDER BY s.started_at DESC
         LIMIT 1`,
        values,
    );
    return result.rows[0] || null;
}

async function listOwnedSessions(pool, orgId) {
    const result = await pool.query(
        `SELECT s.id, s.pipeline_id, s.started_at, s.completed_at, s.status, s.params_json,
                s.xmin::text AS revision,
                p.name AS stored_pipeline_name
         FROM alignment_sessions s
         LEFT JOIN pipelines p ON p.id = s.pipeline_id
         WHERE COALESCE(s.organization_id, p.organization_id) = $1
         ORDER BY s.started_at DESC`,
        [orgId],
    );
    return result.rows;
}

async function createOwnedSession(pool, config, principal) {
    const requestedPipelineId = config?.pipelineId ?? config?.pipeline_id ?? null;
    const { oldRunId, newRunId } = sessionRunReferences(config);
    const result = await pool.query(
        `INSERT INTO alignment_sessions
            (organization_id, created_by, pipeline_id, started_at, status, params_json,
             run_old_id, run_new_id)
         SELECT $1, $2, p.id, NOW(), 'in_progress', $4::jsonb, $5::integer, $6::integer
         FROM (SELECT $3::integer AS requested_id) requested
         LEFT JOIN pipelines p
           ON p.id = requested.requested_id
          AND p.organization_id = $1
         WHERE requested.requested_id IS NULL OR p.id IS NOT NULL
         RETURNING id, status, params_json, xmin::text AS revision`,
        [principal.orgId, principal.id, requestedPipelineId, toJson(config), oldRunId, newRunId],
    );
    return result.rows[0] || null;
}

async function updateOwnedSessionConfig(pool, sessionId, orgId, config, { expectedRevision = null } = {}) {
    const { oldRunId, newRunId } = sessionRunReferences(config);
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $2
              AND COALESCE(s.organization_id, p.organization_id) = $3
         )
         UPDATE alignment_sessions s
         -- The browser sends a wizard snapshot, which never contains the fields
         -- the server writes for itself: the run summary the worker records on
         -- completion, and the interventions, sections and route the reviewer
         -- saves while reading the result.  A plain overwrite dropped them, so
         -- stepping back and forward once after a finished run erased its
         -- resultSummary — and with it the session's route into FFS, because
         -- the handoff gate reads exactly that field.  The snapshot still wins
         -- for every key it does define.
         SET params_json = (
                 COALESCE((
                     SELECT jsonb_object_agg(entry.key, entry.value)
                     FROM jsonb_each(COALESCE(s.params_json::jsonb, '{}'::jsonb)) entry
                     WHERE entry.key = ANY($7::text[])
                 ), '{}'::jsonb) || $1::jsonb
             )::json,
             -- Only ever set, never cleared: a later wizard step may resave a
             -- config snapshot that omits summaryData.
             run_old_id = COALESCE($5::integer, s.run_old_id),
             run_new_id = COALESCE($6::integer, s.run_new_id)
         FROM owned
         WHERE s.id = owned.id
           AND ($4::text IS NULL OR s.xmin::text = $4::text)
         RETURNING s.id, s.status, s.xmin::text AS revision`,
        [
            toJson(config),
            sessionId,
            orgId,
            expectedRevision,
            oldRunId,
            newRunId,
            [...RUNTIME_CONFIG_FIELDS],
        ],
    );
    return result.rows[0] || null;
}

async function markOwnedSessionCompleted(pool, sessionId, orgId, summary) {
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $2
              AND COALESCE(s.organization_id, p.organization_id) = $3
         )
         UPDATE alignment_sessions s
         SET status = 'completed',
             completed_at = NOW(),
             params_json = (
                 COALESCE(s.params_json::jsonb, '{}'::jsonb)
                 || jsonb_build_object('resultSummary', $1::jsonb)
             )::json
         FROM owned
         WHERE s.id = owned.id
         RETURNING s.id, s.status, s.completed_at, s.params_json`,
        [toJson(summary), sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function markOwnedSessionFailed(pool, sessionId, orgId, failureReason) {
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $2
              AND COALESCE(s.organization_id, p.organization_id) = $3
         )
         UPDATE alignment_sessions s
         SET status = 'failed',
             completed_at = NOW(),
             params_json = (
                 COALESCE(s.params_json::jsonb, '{}'::jsonb)
                 || jsonb_build_object('failureReason', $1::text)
             )::json
         FROM owned
         WHERE s.id = owned.id
         RETURNING s.id, s.status, s.completed_at, s.params_json`,
        [String(failureReason || 'Alignment failed'), sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function deleteOwnedSession(pool, sessionId, orgId) {
    const result = await pool.query(
        `WITH owned AS (
            SELECT s.id
            FROM alignment_sessions s
            LEFT JOIN pipelines p ON p.id = s.pipeline_id
            WHERE s.id = $1
              AND COALESCE(s.organization_id, p.organization_id) = $2
         ),
         unlinked AS (
            UPDATE alignment_links
            SET source_job_id = NULL
            WHERE source_job_id IN (SELECT id FROM owned)
            RETURNING id
         ),
         deleted_results AS (
            DELETE FROM alignment_results
            WHERE session_id IN (SELECT id FROM owned)
            RETURNING id
         ),
         -- alignment_jobs cascades its rows, but the job rows themselves were
         -- never cleared here: a deleted session left its result documents in
         -- place for good.
         deleted_jobs AS (
            DELETE FROM alignment_jobs
            WHERE session_id IN (SELECT id FROM owned)
            RETURNING job_id
         )
         DELETE FROM alignment_sessions s
         USING owned
         WHERE s.id = owned.id
         RETURNING s.id`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

async function createAlignmentJob(pool, input) {
    const executionMetadata = JSON.stringify({
        engineVersion: input.engineVersion,
        configFingerprint: input.configFingerprint,
    });
    const result = await pool.query(
        `INSERT INTO alignment_jobs
            (job_id, session_id, organization_id, user_id, state, progress, result_json)
         VALUES ($1, $2, $3, $4, 'queued', 0, $5::jsonb)
         RETURNING *`,
        [input.jobId, input.sessionId, input.organizationId, input.userId || null, executionMetadata],
    );
    return result.rows[0] || null;
}

// result_json holds only execution metadata and the conservation audit once a
// job's rows live in alignment_job_rows, but a job completed before that
// migration still carries its whole comparison array in it.  Selecting the
// column unconditionally means every status poll and every reuse check
// de-TOASTs and parses that legacy document, so it is only read where the rows
// are actually needed.
const JOB_METADATA_COLUMNS = `job_id, session_id, organization_id, user_id, state, progress,
                error_code, error_message, created_at, started_at, completed_at, updated_at,
                row_count`;

/**
 * Job status without its result rows.
 *
 * The client polls this every one to five seconds and then pages the rows in
 * separately, so shipping the comparison here downloaded the whole run twice.
 * The projection drops `comparison` and reduces `groups` to the conservation
 * audit — the only part any consumer reads — inside the database, so a legacy
 * blob is never sent over the wire either.
 */
async function getOwnedAlignmentJob(pool, jobId, orgId) {
    const result = await pool.query(
        `SELECT ${JOB_METADATA_COLUMNS},
                CASE WHEN result_json IS NULL THEN NULL ELSE
                    (result_json - 'comparison' - 'groups')
                    || jsonb_build_object('groups', jsonb_build_object(
                           'audit', COALESCE(result_json #> '{groups,audit}', 'null'::jsonb)))
                END AS result_json
         FROM alignment_jobs WHERE job_id = $1 AND organization_id = $2`,
        [jobId, orgId],
    );
    return result.rows[0] || null;
}

/**
 * The newest job for a session, without its rows.
 *
 * Only `engineVersion`, `configFingerprint` and the conservation audit are read
 * from `result_json` here, so a legacy job's whole comparison array is projected
 * away in the database rather than parsed on every page load.
 */
async function getLatestAlignmentJob(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT ${JOB_METADATA_COLUMNS},
                CASE WHEN result_json IS NULL THEN NULL ELSE
                    (result_json - 'comparison' - 'groups')
                    || jsonb_build_object('groups', jsonb_build_object(
                           'audit', COALESCE(result_json #> '{groups,audit}', 'null'::jsonb)))
                END AS result_json
         FROM alignment_jobs
         WHERE session_id = $1 AND organization_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [sessionId, orgId],
    );
    return result.rows[0] || null;
}

/**
 * Persist one completed run's comparison rows.
 *
 * Rows are written in emit order with the distance the export sorts by already
 * resolved, so neither read path has to expand a JSON array or cast text.
 * Batched inserts keep the statement bounded on a 500k-row export.
 */
async function saveAlignmentJobRows(pool, jobId, rows) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM alignment_job_rows WHERE job_id = $1', [String(jobId)]);
        let ordinal = 0;
        for (let start = 0; start < rows.length; start += RESULT_ROW_INSERT_BATCH) {
            const chunk = rows.slice(start, start + RESULT_ROW_INSERT_BATCH);
            const values = [String(jobId)];
            const tuples = chunk.map((row) => {
                ordinal += 1;
                const distance = comparisonRowDistance(row);
                values.push(ordinal, distance === null ? null : distance, JSON.stringify(row));
                return `($1, $${values.length - 2}, $${values.length - 1}, $${values.length}::jsonb)`;
            });
            await client.query(
                `INSERT INTO alignment_job_rows (job_id, ordinal, sort_distance, row_json)
                 VALUES ${tuples.join(', ')}`,
                values,
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
    return rows.length;
}

/**
 * One page of result rows, as raw JSON text.
 *
 * `row_json` is cast to text rather than selected as jsonb because nothing on
 * this path looks inside a row. Selected as jsonb, the driver ran JSON.parse
 * over every row to build objects that `res.json` immediately serialised back —
 * two full passes over a 20,000-row page, per page, that changed nothing. The
 * text comes out of PostgreSQL already canonical JSON and is spliced straight
 * into the response body.
 *
 * The two storage generations are resolved in one statement, keyed off the
 * chosen job's own `row_count`. The previous shape ran the modern query and
 * fell back to the legacy one whenever it came back empty — which is exactly
 * what the last page of every paginated read does, so every pagination paid for
 * a guaranteed-empty `jsonb_array_elements` expansion at the end. Selecting the
 * newest completed job once also removes the case where the two queries could
 * pick different jobs for the same session.
 *
 * The legacy branch costs nothing for a modern job: those jobs no longer carry
 * a `comparison` key at all, so the COALESCE expands an empty array.
 */
function resultPageQuery(selector) {
    return `WITH completed AS (
            SELECT job_id, result_json, row_count
            FROM alignment_jobs
            WHERE ${selector}
              AND organization_id = $2
              AND state = 'completed'
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT 1
         ),
         persisted AS (
            SELECT r.row_json::text AS row, r.ordinal
            FROM completed c
            JOIN alignment_job_rows r ON r.job_id = c.job_id
            WHERE c.row_count IS NOT NULL
              AND r.ordinal > $3
         ),
         legacy AS (
            SELECT item.value::text AS row, item.ordinality::int AS ordinal
            FROM completed c
            CROSS JOIN LATERAL jsonb_array_elements(
                COALESCE(c.result_json->'comparison', '[]'::jsonb)
            ) WITH ORDINALITY AS item(value, ordinality)
            WHERE c.row_count IS NULL
              AND item.ordinality > $3
         )
         SELECT row, ordinal
         FROM (SELECT * FROM persisted UNION ALL SELECT * FROM legacy) page
         ORDER BY ordinal ASC
         LIMIT $4`;
}

function pageResponse(rows, limit) {
    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;
    const tail = page[page.length - 1];
    return {
        rows: page.map((row) => row.row),
        nextCursor: hasNextPage && tail ? Number(tail.ordinal) : null,
    };
}

/**
 * The paged response as a JSON string.
 *
 * `rows` are already-serialised JSON documents, so handing them to `res.json`
 * would re-encode each one as a quoted string. They are spliced into the array
 * literal instead. Every element came out of PostgreSQL as `jsonb::text`, which
 * is always a complete, well-formed JSON value — jsonb cannot hold an unescaped
 * control character or a NUL, so there is nothing here that needs escaping.
 */
function serializeAlignmentResultPage(page) {
    const cursor = page.nextCursor === null
        ? 'null'
        : JSON.stringify(String(page.nextCursor));
    return `{"items":[${page.rows.join(',')}],"nextCursor":${cursor}}`;
}

async function listOwnedAlignmentResultPage(pool, sessionId, orgId, { limit, after }) {
    const startedAt = performance.now();
    const values = [sessionId, orgId, after === null ? 0 : after, limit + 1];
    const result = await pool.query(resultPageQuery('session_id = $1'), values);
    metrics.observe('alignment_result_query', performance.now() - startedAt, { query: 'page' });
    return pageResponse(result.rows, limit);
}

/**
 * One page of a specific completed run, rather than of whichever run happens to
 * be the newest for its session. A published link names the run it was made
 * from, so re-running the alignment can never change what that link shows.
 */
async function listOwnedAlignmentJobResultPage(pool, jobId, orgId, { limit, after }) {
    const startedAt = performance.now();
    const values = [String(jobId), orgId, after === null ? 0 : after, limit + 1];
    const result = await pool.query(resultPageQuery('job_id = $1'), values);
    metrics.observe('alignment_result_query', performance.now() - startedAt, { query: 'job_page' });
    return pageResponse(result.rows, limit);
}

async function findOwnedAlignmentExport(pool, sessionId, orgId) {
    const result = await pool.query(
        `SELECT j.job_id,
                j.row_count IS NOT NULL AS rows_persisted,
                COALESCE(
                    j.row_count,
                    jsonb_array_length(COALESCE(j.result_json->'comparison', '[]'::jsonb))
                ) AS row_count
         FROM alignment_jobs j
         WHERE j.session_id = $1
           AND j.organization_id = $2
           AND j.state = 'completed'
         ORDER BY j.completed_at DESC NULLS LAST, j.created_at DESC
         LIMIT 1`,
        [sessionId, orgId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
        jobId: row.job_id,
        rowCount: Number(row.row_count || 0),
        rowsPersisted: Boolean(row.rows_persisted),
    };
}

async function* iterateOwnedAlignmentExportRows(
    pool,
    jobId,
    orgId,
    { batchSize = 2_000 } = {},
) {
    const fetchSize = Number.isSafeInteger(batchSize) && batchSize > 0
        ? Math.min(batchSize, 10_000)
        : 2_000;
    const client = await pool.connect();
    let transactionOpen = false;
    let cursorOpen = false;
    let completed = false;

    try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        transactionOpen = true;
        // Bind ownership values once, then read them from transaction-local
        // settings inside DECLARE (PostgreSQL does not bind FETCH/DECLARE
        // parameters consistently across drivers).
        await client.query(
            `SELECT set_config('synapse.export_job_id', $1, true),
                    set_config('synapse.export_org_id', $2, true)`,
            [String(jobId), String(orgId)],
        );
        // The workbook has to read like the pipeline, so rows leave in distance
        // order rather than in the order the engine happened to emit its buckets.
        // Rows written to alignment_job_rows carry that distance in a column and
        // an index already provides the ordering.  Results stored before that
        // migration still live inside result_json, and the legacy branch is what
        // makes their export come out walkable anyway: numeric text is guarded
        // there because a distance column can legitimately hold "-" for a row
        // with no NEW odometer, and an unguarded cast would abort the export.
        await client.query(
            `DECLARE alignment_export_rows NO SCROLL CURSOR FOR
             WITH job AS (
                 SELECT job_id, result_json, row_count
                 FROM alignment_jobs
                 WHERE job_id = current_setting('synapse.export_job_id')
                   AND organization_id = current_setting('synapse.export_org_id')::bigint
                   AND state = 'completed'
                 LIMIT 1
             ),
             persisted AS (
                 SELECT r.row_json AS row, r.sort_distance AS distance, r.ordinal
                 FROM job j
                 JOIN alignment_job_rows r ON r.job_id = j.job_id
                 WHERE j.row_count IS NOT NULL
             ),
             legacy AS (
                 SELECT item.value AS row,
                        COALESCE(
                            ${EXPORT_DISTANCE_KEYS.map((key) => (
                                `CASE WHEN item.value->>'${key}' ~ '${NUMERIC_TEXT_PATTERN}'
                                       THEN (item.value->>'${key}')::numeric END`
                            )).join(',\n                            ')}
                        ) AS distance,
                        item.ordinality::int AS ordinal
                 FROM job j
                 CROSS JOIN LATERAL jsonb_array_elements(
                     COALESCE(j.result_json->'comparison', '[]'::jsonb)
                 ) WITH ORDINALITY AS item(value, ordinality)
                 WHERE j.row_count IS NULL
             )
             SELECT row FROM (
                 SELECT * FROM persisted
                 UNION ALL
                 SELECT * FROM legacy
             ) ordered
             ORDER BY distance ASC NULLS LAST, ordinal ASC`,
        );
        cursorOpen = true;

        while (true) {
            const batch = await client.query(
                `FETCH FORWARD ${fetchSize} FROM alignment_export_rows`,
            );
            if (batch.rows.length === 0) break;
            for (const item of batch.rows) yield item.row;
        }
        completed = true;
    } finally {
        if (cursorOpen) {
            await client.query('CLOSE alignment_export_rows').catch(() => {});
        }
        if (transactionOpen) {
            await client.query(completed ? 'COMMIT' : 'ROLLBACK').catch(() => {});
        }
        client.release();
    }
}

async function updateAlignmentJob(pool, jobId, patch) {
    const values = [];
    const fields = [];
    const add = (field, value) => {
        values.push(value);
        fields.push(`${field} = $${values.length}`);
    };
    if (patch.state !== undefined) add('state', patch.state);
    if (patch.progress !== undefined) add('progress', patch.progress);
    if (patch.result !== undefined) add('result_json', JSON.stringify(patch.result));
    if (patch.rowCount !== undefined) add('row_count', patch.rowCount);
    if (patch.errorCode !== undefined) add('error_code', patch.errorCode);
    if (patch.errorMessage !== undefined) add('error_message', patch.errorMessage);
    if (patch.startedAt) add('started_at', patch.startedAt);
    if (patch.completedAt) add('completed_at', patch.completedAt);
    fields.push('updated_at = NOW()');
    values.push(jobId);
    // Scoping the write to the owning organization keeps a job id that leaked
    // out of one tenant from ever addressing another tenant's row.
    if (patch.organizationId !== undefined) {
        values.push(patch.organizationId);
        const result = await pool.query(
            `UPDATE alignment_jobs SET ${fields.join(', ')}
             WHERE job_id = $${values.length - 1} AND organization_id = $${values.length}
             RETURNING ${JOB_METADATA_COLUMNS}`,
            values,
        );
        return result.rows[0] || null;
    }
    const result = await pool.query(
        `UPDATE alignment_jobs SET ${fields.join(', ')}
         WHERE job_id = $${values.length} RETURNING ${JOB_METADATA_COLUMNS}`,
        values,
    );
    return result.rows[0] || null;
}

function serializeAlignmentJob(row) {
    if (!row) return null;
    // `result` deliberately never carries the comparison rows: the client polls
    // this endpoint on a timer and reads the rows through the paged endpoint.
    return {
        jobId: row.job_id,
        state: row.state,
        progress: Number(row.progress || 0),
        result: row.result_json || null,
        rowCount: row.row_count === null || row.row_count === undefined
            ? null
            : Number(row.row_count),
        failedReason: row.error_message || null,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}

module.exports = {
    createAlignmentJob,
    findOwnedSession,
    findLatestOwnedSession,
    getLatestAlignmentJob,
    getOwnedAlignmentJob,
    findOwnedAlignmentExport,
    iterateOwnedAlignmentExportRows,
    listOwnedAlignmentJobResultPage,
    listOwnedAlignmentResultPage,
    listOwnedSessions,
    serializeAlignmentResultPage,
    saveAlignmentJobRows,
    createOwnedSession,
    updateOwnedSessionConfig,
    markOwnedSessionCompleted,
    markOwnedSessionFailed,
    deleteOwnedSession,
    serializeAlignmentJob,
    updateAlignmentJob,
};
