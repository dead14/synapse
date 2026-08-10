-- Weld-relative distance that Synapse computed, kept apart from the one the
-- vendor reported.
--
-- Many pipetally exports leave "Dist. to U/S GW" blank, and it is the strongest
-- identity evidence the matcher has: it survives an odometer that drifted. The
-- value is recoverable from the feature's own odometer and the run's girth
-- welds, so a generator fills it in.
--
-- It goes in its own column rather than into `dist_to_us_gw_m` because the two
-- are not the same measurement. A vendor measures to the weld centreline; this
-- measures to the odometer the weld feature was reported at, and the two differ
-- by a fixed bias per run. Overwriting would destroy the vendor reading for good
-- and leave nothing able to tell a computed number from a surveyed one — and
-- comparing a vendor value on one run against a computed value on the other is
-- exactly the mistake that feeds that bias into the identity gate.
ALTER TABLE ili_features
    ADD COLUMN IF NOT EXISTS dist_to_us_gw_derived_m DOUBLE PRECISION;

-- Which girth weld the value above was measured from, as that run's own
-- odometer. Without it a derived distance cannot be audited back to a physical
-- reference, only trusted.
ALTER TABLE ili_features
    ADD COLUMN IF NOT EXISTS us_gw_reference_m DOUBLE PRECISION;

-- Per-run record of what the generator did, so a reviewer can see when it ran,
-- against which girth welds, and how much of the run it could reach. One row
-- per run: re-running the generator replaces the record rather than appending,
-- because only the current state of the columns above is meaningful.
CREATE TABLE IF NOT EXISTS run_gw_distance_generation (
    run_id INTEGER PRIMARY KEY REFERENCES survey_runs(id) ON DELETE CASCADE,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    girth_welds INTEGER NOT NULL,
    derived_count INTEGER NOT NULL,
    no_upstream_weld_count INTEGER NOT NULL,
    unreadable_distance_count INTEGER NOT NULL,
    vendor_reported_count INTEGER NOT NULL,
    feature_count INTEGER NOT NULL,
    median_joint_length_m DOUBLE PRECISION,
    generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
