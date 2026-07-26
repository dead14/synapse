async function createOwnedFieldMeasurement(pool, orgId, userId, input) {
    const result = await pool.query(
        `INSERT INTO field_measurements
            (organization_id, integrity_case_id, survey_run_id, ili_feature_id,
             measurement_type, observed_at, chainage_m, depth_pct, depth_mm,
             depth_uncertainty_pct, length_mm, width_mm, source_reference,
             source_row, metadata, status, created_by)
         SELECT $1, c.id, sr.id, f.id,
                $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'submitted', $16
         FROM integrity_cases c
         LEFT JOIN survey_runs sr ON sr.id = $3 AND sr.pipeline_id = c.pipeline_id
         LEFT JOIN ili_features f ON f.id = $4 AND f.run_id = sr.id
         WHERE c.id = $2 AND c.organization_id = $1
           AND ($3::integer IS NULL OR sr.id IS NOT NULL)
           AND ($4::integer IS NULL OR f.id IS NOT NULL)
         RETURNING *`,
        [
            orgId, input.integrityCaseId, input.surveyRunId, input.iliFeatureId,
            input.measurementType, input.observedAt, input.chainageM, input.depthPct,
            input.depthMm, input.depthUncertaintyPct, input.lengthMm, input.widthMm,
            input.sourceReference, input.sourceRow, input.metadata, userId,
        ],
    );
    return result.rows[0] || null;
}

async function listOwnedFieldMeasurements(pool, orgId, { limit, beforeId, integrityCaseId }) {
    const values = [orgId];
    const filters = ['fm.organization_id = $1'];
    if (beforeId !== null) {
        values.push(beforeId);
        filters.push(`fm.id < $${values.length}`);
    }
    if (integrityCaseId !== null) {
        values.push(integrityCaseId);
        filters.push(`fm.integrity_case_id = $${values.length}`);
    }
    values.push(limit + 1);
    const result = await pool.query(
        `SELECT fm.*, c.anomaly_key
         FROM field_measurements fm
         JOIN integrity_cases c ON c.id = fm.integrity_case_id
         WHERE ${filters.join(' AND ')}
         ORDER BY fm.id DESC
         LIMIT $${values.length}`,
        values,
    );
    const rows = result.rows.slice(0, limit);
    return {
        rows,
        nextCursor: result.rows.length > limit ? rows.at(-1)?.id ?? null : null,
    };
}

module.exports = { createOwnedFieldMeasurement, listOwnedFieldMeasurements };
