-- Alignment results move out of the job's JSONB blob and into their own rows.
--
-- `alignment_jobs.result_json` used to carry the whole comparison array (and a
-- second copy of every row under `groups`).  Every page request then ran
-- `jsonb_array_elements` over the entire document just to slice 20k rows out of
-- it, so paging a 200k-row run re-parsed 200k elements ten times over, and the
-- polling endpoint shipped the full document on each poll.  One row per result
-- turns all of that into an index range scan.
--
-- `sort_distance` is resolved once at write time from the same distance-key
-- precedence the contract uses, so the export no longer regex-matches and casts
-- four JSON keys per row inside an ORDER BY.
CREATE TABLE IF NOT EXISTS alignment_job_rows (
    job_id TEXT NOT NULL REFERENCES alignment_jobs(job_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    sort_distance NUMERIC,
    row_json JSONB NOT NULL,
    PRIMARY KEY (job_id, ordinal)
);

-- The export walks rows in pipeline order; paging walks them in emit order.
CREATE INDEX IF NOT EXISTS ix_alignment_job_rows_distance
    ON alignment_job_rows (job_id, sort_distance ASC NULLS LAST, ordinal ASC);

-- Non-null marks a job whose rows live in alignment_job_rows.  Jobs completed
-- before this migration keep their rows inside result_json and are still read
-- through the legacy path, so an existing session is never orphaned.
ALTER TABLE alignment_jobs
    ADD COLUMN IF NOT EXISTS row_count INTEGER;

-- ili_features carried two standalone indexes that no query can use: every read
-- path filters on run_id first, and the composite (run_id, log_distance_m) and
-- partial anchor indexes already cover those lookups.  They only ever cost write
-- throughput on the COPY that ingests a run.
DROP INDEX IF EXISTS ix_ili_features_log_distance_m;
DROP INDEX IF EXISTS ix_ili_features_feature_type;
