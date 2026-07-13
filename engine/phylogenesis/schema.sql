-- =============================================================================
-- SCHEMA FILOGENESIS - Pipeline Inspection Phylogenetic Alignment
-- =============================================================================
-- Data model untuk mendukung algoritma filogenesis ILI alignment.
-- Tabel-tabel ini melengkapi schema existing (bukan mengganti).
-- =============================================================================

-- Tabel master koordinat pipeline. Setiap fitur fisik punya SATU posisi
-- kanonik (abs_chainage) yang menjadi sumber kebenaran lintas generasi ILI run.
CREATE TABLE IF NOT EXISTS canonical_anchors (
    id              SERIAL PRIMARY KEY,
    pipeline_id     INTEGER NOT NULL,
    abs_chainage    FLOAT NOT NULL,          -- koordinat master pipeline (meter)
    sigma           FLOAT NOT NULL DEFAULT 0.5, -- ketidakpastian posisi (meter)
    confidence      FLOAT NOT NULL DEFAULT 0.5, -- 0..1
    is_golden       BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = sudah validasi manual / tally book
    anchor_type     VARCHAR(20) NOT NULL DEFAULT 'GW',  -- GW, TEE, VALVE, SLEEVE, METAL_LOSS
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_confidence CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT chk_sigma CHECK (sigma > 0)
);

CREATE INDEX IF NOT EXISTS idx_canonical_pipeline ON canonical_anchors(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_canonical_chainage ON canonical_anchors(pipeline_id, abs_chainage);
CREATE INDEX IF NOT EXISTS idx_canonical_golden ON canonical_anchors(pipeline_id, is_golden);

-- Tabel link antara canonical anchor dan odometer pada ILI run tertentu.
-- Satu canonical bisa punya banyak link (satu per ILI run).
CREATE TABLE IF NOT EXISTS alignment_links (
    id              SERIAL PRIMARY KEY,
    canonical_id    INTEGER NOT NULL REFERENCES canonical_anchors(id) ON DELETE CASCADE,
    ili_run_id      INTEGER NOT NULL,
    odometer        FLOAT NOT NULL,           -- posisi odometer pada ILI run ini
    confidence      FLOAT NOT NULL DEFAULT 0.5,
    source_job_id   INTEGER,                  -- job ID yang membuat link ini
    is_outlier      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_link_confidence CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_links_canonical ON alignment_links(canonical_id);
CREATE INDEX IF NOT EXISTS idx_links_run ON alignment_links(ili_run_id);
CREATE INDEX IF NOT EXISTS idx_links_job ON alignment_links(source_job_id);
CREATE INDEX IF NOT EXISTS idx_links_outlier ON alignment_links(ili_run_id, is_outlier);

-- Tabel fitur ILI (GW, TEE, VALVE, dll) per run.
CREATE TABLE IF NOT EXISTS features (
    id              SERIAL PRIMARY KEY,
    ili_run_id      INTEGER NOT NULL,
    feature_type    VARCHAR(20) NOT NULL CHECK (feature_type IN ('GW','TEE','VALVE','SLEEVE','METAL_LOSS')),
    odometer        FLOAT NOT NULL,
    metadata        JSONB,                     -- data tambahan (depth, clock, length, width, dll)
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_features_run ON features(ili_run_id);
CREATE INDEX IF NOT EXISTS idx_features_type ON features(ili_run_id, feature_type);
CREATE INDEX IF NOT EXISTS idx_features_odom ON features(ili_run_id, odometer);

-- Tabel ILI runs (inspeksi per tahun).
CREATE TABLE IF NOT EXISTS ili_runs (
    id              SERIAL PRIMARY KEY,
    pipeline_id     INTEGER NOT NULL,
    year            INTEGER NOT NULL,
    description     VARCHAR(255),
    vendor          VARCHAR(100),
    tool_type       VARCHAR(50),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_runs_pipeline ON ili_runs(pipeline_id);

-- Tabel job tracking untuk rebase chain.
CREATE TABLE IF NOT EXISTS alignment_jobs (
    id              SERIAL PRIMARY KEY,
    pipeline_id     INTEGER NOT NULL,
    source_run_id   INTEGER NOT NULL,
    target_run_id   INTEGER NOT NULL,
    algorithm       VARCHAR(50) NOT NULL DEFAULT 'phylogenetic',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
    result_summary  JSONB,                    -- statistik: inliers, outliers, block_count, dll
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_pipeline ON alignment_jobs(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON alignment_jobs(status);
