/**
 * Storage for the pipeline dossier.
 *
 * Ownership is the organization on the pipeline row, checked on every read and
 * write: a pipeline id from another tenant must be indistinguishable from one
 * that does not exist.
 */

const SPEC_COLUMNS = `
    environment, product_medium, length_km, location_class,
    installation_year, commissioning_year, design_life_years,
    outer_diameter_mm, nominal_wall_thickness_mm, smys_mpa, design_factor,
    material_grade, seam_type, external_coating,
    maop_mpa, design_pressure_mpa, operating_pressure_mpa,
    internal_design_pressure_mpa, weld_joint_factor, yield_to_tensile_ratio,
    notes, updated_at`;

function numberOrNull(value) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function serializeSegment(row) {
    return {
        id: String(row.id),
        label: row.label,
        startM: numberOrNull(row.start_m),
        endM: numberOrNull(row.end_m),
        outerDiameterMm: numberOrNull(row.outer_diameter_mm),
        nominalWallThicknessMm: numberOrNull(row.nominal_wall_thickness_mm),
        smysMpa: numberOrNull(row.smys_mpa),
        designFactor: numberOrNull(row.design_factor),
        materialGrade: row.material_grade || null,
        seamType: row.seam_type || null,
    };
}

function serializeSpecification(row, segments) {
    return {
        environment: row.environment || null,
        productMedium: row.product_medium || null,
        lengthKm: numberOrNull(row.length_km),
        locationClass: row.location_class || null,
        installationYear: numberOrNull(row.installation_year),
        commissioningYear: numberOrNull(row.commissioning_year),
        designLifeYears: numberOrNull(row.design_life_years),
        outerDiameterMm: numberOrNull(row.outer_diameter_mm),
        nominalWallThicknessMm: numberOrNull(row.nominal_wall_thickness_mm),
        smysMpa: numberOrNull(row.smys_mpa),
        designFactor: numberOrNull(row.design_factor),
        materialGrade: row.material_grade || null,
        seamType: row.seam_type || null,
        externalCoating: row.external_coating || null,
        maopMpa: numberOrNull(row.maop_mpa),
        designPressureMpa: numberOrNull(row.design_pressure_mpa),
        operatingPressureMpa: numberOrNull(row.operating_pressure_mpa),
        internalDesignPressureMpa: numberOrNull(row.internal_design_pressure_mpa),
        weldJointFactor: numberOrNull(row.weld_joint_factor),
        yieldToTensileRatio: numberOrNull(row.yield_to_tensile_ratio),
        notes: row.notes || null,
        updatedAt: row.updated_at,
        segments: segments.map(serializeSegment),
    };
}

async function findOwnedPipeline(pool, pipelineId, orgId) {
    const result = await pool.query(
        `SELECT id, name FROM pipelines WHERE id = $1 AND organization_id = $2`,
        [pipelineId, orgId],
    );
    return result.rows[0] || null;
}

/**
 * The dossier for one pipeline, or null when nothing has been filed yet.
 *
 * A pipeline with no dossier is the ordinary starting state — every line
 * uploaded before this record existed is in it — so the caller reports "not
 * recorded", never an error.
 */
async function getPipelineSpecification(pool, pipelineId, orgId) {
    const pipeline = await findOwnedPipeline(pool, pipelineId, orgId);
    if (!pipeline) return null;

    const [spec, segments] = await Promise.all([
        pool.query(
            `SELECT ${SPEC_COLUMNS} FROM pipeline_specifications WHERE pipeline_id = $1`,
            [pipelineId],
        ),
        pool.query(
            `SELECT id, label, start_m, end_m, outer_diameter_mm, nominal_wall_thickness_mm,
                    smys_mpa, design_factor, material_grade, seam_type
             FROM pipeline_segments
             WHERE pipeline_id = $1
             ORDER BY position ASC`,
            [pipelineId],
        ),
    ]);

    return {
        pipelineId: Number(pipeline.id),
        pipelineName: pipeline.name,
        recorded: spec.rows.length > 0,
        specification: spec.rows.length > 0
            ? serializeSpecification(spec.rows[0], segments.rows)
            : null,
    };
}

const SPEC_VALUE_ORDER = [
    'environment', 'productMedium', 'lengthKm', 'locationClass',
    'installationYear', 'commissioningYear', 'designLifeYears',
    'outerDiameterMm', 'nominalWallThicknessMm', 'smysMpa', 'designFactor',
    'materialGrade', 'seamType', 'externalCoating',
    'maopMpa', 'designPressureMpa', 'operatingPressureMpa',
    'internalDesignPressureMpa', 'weldJointFactor', 'yieldToTensileRatio',
    'notes',
];

/**
 * Files the dossier, replacing whatever was there.
 *
 * The segment register is rewritten wholesale inside the same transaction as
 * the line record: a half-applied register would describe a line that steps
 * from one diameter to another and back to nothing.
 */
async function savePipelineSpecification(pool, pipelineId, orgId, specification, userId) {
    const pipeline = await findOwnedPipeline(pool, pipelineId, orgId);
    if (!pipeline) return null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO pipeline_specifications
                (pipeline_id, organization_id,
                 environment, product_medium, length_km, location_class,
                 installation_year, commissioning_year, design_life_years,
                 outer_diameter_mm, nominal_wall_thickness_mm, smys_mpa, design_factor,
                 material_grade, seam_type, external_coating,
                 maop_mpa, design_pressure_mpa, operating_pressure_mpa,
                 internal_design_pressure_mpa, weld_joint_factor, yield_to_tensile_ratio,
                 notes, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                     $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW())
             ON CONFLICT (pipeline_id) DO UPDATE SET
                 environment = EXCLUDED.environment,
                 product_medium = EXCLUDED.product_medium,
                 length_km = EXCLUDED.length_km,
                 location_class = EXCLUDED.location_class,
                 installation_year = EXCLUDED.installation_year,
                 commissioning_year = EXCLUDED.commissioning_year,
                 design_life_years = EXCLUDED.design_life_years,
                 outer_diameter_mm = EXCLUDED.outer_diameter_mm,
                 nominal_wall_thickness_mm = EXCLUDED.nominal_wall_thickness_mm,
                 smys_mpa = EXCLUDED.smys_mpa,
                 design_factor = EXCLUDED.design_factor,
                 material_grade = EXCLUDED.material_grade,
                 seam_type = EXCLUDED.seam_type,
                 external_coating = EXCLUDED.external_coating,
                 maop_mpa = EXCLUDED.maop_mpa,
                 design_pressure_mpa = EXCLUDED.design_pressure_mpa,
                 operating_pressure_mpa = EXCLUDED.operating_pressure_mpa,
                 internal_design_pressure_mpa = EXCLUDED.internal_design_pressure_mpa,
                 weld_joint_factor = EXCLUDED.weld_joint_factor,
                 yield_to_tensile_ratio = EXCLUDED.yield_to_tensile_ratio,
                 notes = EXCLUDED.notes,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW()`,
            [
                pipelineId,
                orgId,
                ...SPEC_VALUE_ORDER.map((field) => specification[field] ?? null),
                userId ?? null,
            ],
        );

        await client.query('DELETE FROM pipeline_segments WHERE pipeline_id = $1', [pipelineId]);
        for (const segment of specification.segments) {
            await client.query(
                `INSERT INTO pipeline_segments
                    (pipeline_id, position, label, start_m, end_m,
                     outer_diameter_mm, nominal_wall_thickness_mm, smys_mpa,
                     design_factor, material_grade, seam_type)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    pipelineId,
                    segment.position,
                    segment.label,
                    segment.startM,
                    segment.endM,
                    segment.outerDiameterMm,
                    segment.nominalWallThicknessMm,
                    segment.smysMpa,
                    segment.designFactor,
                    segment.materialGrade,
                    segment.seamType,
                ],
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }

    return getPipelineSpecification(pool, pipelineId, orgId);
}

/**
 * Every pipeline this organization owns, with enough of its dossier to read the
 * register at a glance: how many stretches it carries and which diameters.
 */
async function listPipelines(pool, orgId) {
    const result = await pool.query(
        `SELECT p.id,
                p.name,
                p.created_at,
                s.outer_diameter_mm,
                s.nominal_wall_thickness_mm,
                s.smys_mpa,
                s.design_factor,
                s.length_km,
                s.material_grade,
                s.updated_at,
                (s.pipeline_id IS NOT NULL) AS recorded,
                COALESCE(seg.segment_count, 0) AS segment_count,
                seg.diameters,
                COALESCE(runs.run_count, 0) AS run_count
         FROM pipelines p
         LEFT JOIN pipeline_specifications s ON s.pipeline_id = p.id
         LEFT JOIN (
             SELECT pipeline_id,
                    COUNT(*) AS segment_count,
                    ARRAY_AGG(DISTINCT outer_diameter_mm)
                        FILTER (WHERE outer_diameter_mm IS NOT NULL) AS diameters
             FROM pipeline_segments
             GROUP BY pipeline_id
         ) seg ON seg.pipeline_id = p.id
         LEFT JOIN (
             SELECT pipeline_id, COUNT(*) AS run_count
             FROM survey_runs
             GROUP BY pipeline_id
         ) runs ON runs.pipeline_id = p.id
         WHERE p.organization_id = $1
         ORDER BY p.name ASC`,
        [orgId],
    );

    return result.rows.map((row) => ({
        pipelineId: Number(row.id),
        pipelineName: row.name,
        createdAt: row.created_at,
        recorded: Boolean(row.recorded),
        updatedAt: row.updated_at || null,
        runCount: Number(row.run_count) || 0,
        segmentCount: Number(row.segment_count) || 0,
        lengthKm: numberOrNull(row.length_km),
        outerDiameterMm: numberOrNull(row.outer_diameter_mm),
        nominalWallThicknessMm: numberOrNull(row.nominal_wall_thickness_mm),
        smysMpa: numberOrNull(row.smys_mpa),
        designFactor: numberOrNull(row.design_factor),
        materialGrade: row.material_grade || null,
        // Every diameter the register names, plus the line default, so the row
        // can say "20 in stepping to 24 in" without opening the dossier.
        segmentDiameters: (row.diameters || [])
            .map(numberOrNull)
            .filter((value) => value !== null)
            .sort((left, right) => left - right),
    }));
}

module.exports = {
    findOwnedPipeline,
    getPipelineSpecification,
    listPipelines,
    savePipelineSpecification,
    serializeSpecification,
};
