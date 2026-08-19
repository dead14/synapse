-- The pipeline dossier becomes a record instead of a form.
--
-- The alignment intake already asked for the line's design data — diameter,
-- wall, grade, pressures — but nothing kept it: the values travelled in the
-- wizard's navigation state as far as the Excel export and were gone on the
-- next visit. FFS then asked the same engineer for the same numbers again, in
-- different units and under different names, with no way to tell whether the
-- two screens had been given the same line. This table is the answer to both:
-- one dossier per pipeline, written once at intake and read by every
-- assessment that follows.
--
-- Everything numeric is stored canonical — millimetres and megapascals, the
-- units the B31G kernel works in — so a screen may offer inches or psi without
-- the stored line record depending on which unit happened to be selected.
CREATE TABLE IF NOT EXISTS pipeline_specifications (
    pipeline_id                  INTEGER PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
    organization_id              INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Asset and operations.
    environment                  TEXT,
    product_medium               TEXT,
    length_km                    DOUBLE PRECISION,
    location_class               TEXT,
    installation_year            INTEGER,
    -- The year the line went into service. Distinct from installation: FFS
    -- measures consumed design life and the service-age corrosion rate from
    -- this one, so the two are not interchangeable.
    commissioning_year           INTEGER,
    design_life_years            DOUBLE PRECISION,

    -- Line default pipe. A section that carries its own values overrides
    -- these; a line of one size never needs a segment at all.
    outer_diameter_mm            DOUBLE PRECISION,
    nominal_wall_thickness_mm    DOUBLE PRECISION,
    smys_mpa                     DOUBLE PRECISION,
    design_factor                DOUBLE PRECISION,
    material_grade               TEXT,
    seam_type                    TEXT,
    external_coating             TEXT,

    -- Pressures, all MPa.
    maop_mpa                     DOUBLE PRECISION,
    design_pressure_mpa          DOUBLE PRECISION,
    operating_pressure_mpa       DOUBLE PRECISION,
    -- The P of ASME B31.4 para. 403.2.1, which sets the design thickness the
    -- 20 % no-repair band is a fraction of.
    internal_design_pressure_mpa DOUBLE PRECISION,

    -- Code inputs carried alongside B31G rather than into it.
    weld_joint_factor            DOUBLE PRECISION,
    yield_to_tensile_ratio       DOUBLE PRECISION,

    notes                        TEXT,
    updated_by                   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_pipeline_specifications_organization
    ON pipeline_specifications (organization_id);

-- The pipe register: what the line is physically made of, stretch by stretch.
--
-- A line that steps from 20 in to 24 in at a reducer, or from X52 to X60 across
-- a replacement spool, has no single diameter or grade to assess against — B31G
-- carries D in the failure pressure and in the Folias term, and SMYS sets the
-- flow stress. One row per stretch of uniform pipe, bounded on odometer metres
-- so an assessment can tell which stretch a feature sits in.
--
-- This is the asset record, not the assessment. FFS still resolves its numbers
-- per named section (the stretches an engineer bounded on girth welds); the
-- register is what those sections are pre-filled from.
CREATE TABLE IF NOT EXISTS pipeline_segments (
    id                        BIGSERIAL PRIMARY KEY,
    pipeline_id               INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    -- Display order, and the tiebreak when two stretches overlap.
    position                  INTEGER NOT NULL,
    label                     TEXT NOT NULL,
    -- Odometer metres from the launcher. Null on either side means the stretch
    -- is open-ended in that direction.
    start_m                   DOUBLE PRECISION,
    end_m                     DOUBLE PRECISION,
    outer_diameter_mm         DOUBLE PRECISION,
    nominal_wall_thickness_mm DOUBLE PRECISION,
    smys_mpa                  DOUBLE PRECISION,
    design_factor             DOUBLE PRECISION,
    material_grade            TEXT,
    seam_type                 TEXT,
    CONSTRAINT uq_pipeline_segments_position UNIQUE (pipeline_id, position)
);

CREATE INDEX IF NOT EXISTS ix_pipeline_segments_pipeline
    ON pipeline_segments (pipeline_id, position);
