BEGIN;

-- Serves the canonical anchor read path used by tie-in and GW matching.
-- Keeping this separate from the original ingestion migration makes it safe
-- for databases that have already recorded migration 002 as applied.
CREATE INDEX IF NOT EXISTS ix_ili_features_run_anchor_distance
    ON ili_features (run_id, log_distance_m, id)
    WHERE feature_type IN ('Weld', 'Valve', 'Tee');

COMMIT;
