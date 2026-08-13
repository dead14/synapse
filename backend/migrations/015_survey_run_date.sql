-- The calendar date an inspection run was flown, not just its year.
--
-- `survey_year` is what the intake asked for and it is enough to order runs and
-- to write "Survey year OLD/NEW" into a comparison. It is not enough for a
-- fitness-for-service assessment: remnant life, growth interval and the
-- next-inspection date are all measured from the day the tool ran, so an
-- engineer had to re-type the ILI date by hand on the FFS setup screen even
-- though the run it belongs to was already in this table.
--
-- The year column stays. It is indexed, every engine and export reads it, and
-- it remains authoritative for runs uploaded before this column existed — where
-- the date is genuinely unknown and must read as unknown rather than as
-- 1 January. New uploads fill both; `survey_year` is derived from the date so
-- the two can never disagree.
ALTER TABLE survey_runs
    ADD COLUMN IF NOT EXISTS survey_date DATE;

-- Carried on the job as well so the date survives a queued upload that is
-- still waiting for a worker, and so a failed job can be inspected for what it
-- was asked to ingest.
ALTER TABLE ingestion_jobs
    ADD COLUMN IF NOT EXISTS survey_date DATE;

-- Chronology reads (latest run for a line, run ordering inside a session) go
-- via the date when it is present and fall back to the year when it is not.
CREATE INDEX IF NOT EXISTS ix_survey_runs_pipeline_survey_date
    ON survey_runs (pipeline_id, survey_date DESC NULLS LAST);
