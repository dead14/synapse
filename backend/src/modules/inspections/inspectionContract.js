function asNonNegativeInteger(value, fallback = null) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function asFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseInspectionListQuery(query = {}) {
    const limit = query.limit === undefined ? 30 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('limit must be an integer between 1 and 100');
    }

    if (query.cursor === undefined || query.cursor === '') {
        return { limit, beforeId: null };
    }

    const beforeId = Number(query.cursor);
    if (!Number.isSafeInteger(beforeId) || beforeId < 1) {
        throw new Error('cursor must be a positive inspection run id');
    }

    return { limit, beforeId };
}

function decodeAnchorCursor(value) {
    try {
        const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
        const distanceM = asFiniteNumber(parsed?.distanceM);
        const id = Number(parsed?.id);
        if (distanceM === null || !Number.isSafeInteger(id) || id < 1) {
            throw new Error('invalid cursor');
        }
        return { distanceM, id };
    } catch {
        throw new Error('cursor must be a valid inspection anchor cursor');
    }
}

function parseInspectionAnchorListQuery(query = {}) {
    const limit = query.limit === undefined ? 1000 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
        throw new Error('limit must be an integer between 1 and 5000');
    }

    if (query.cursor === undefined || query.cursor === '') {
        return { limit, after: null };
    }

    return { limit, after: decodeAnchorCursor(query.cursor) };
}

function parseViewportRange(query = {}, { defaultBucketM = null } = {}) {
    const fromM = asFiniteNumber(query.fromM);
    const toM = asFiniteNumber(query.toM);
    if (fromM === null || toM === null || fromM < 0 || toM <= fromM) {
        throw new Error('fromM and toM must define a positive range');
    }
    if (toM - fromM > 250_000) {
        throw new Error('viewport range cannot exceed 250000 meters');
    }
    const bucketM = defaultBucketM === null ? null : asFiniteNumber(query.bucketM ?? defaultBucketM);
    if (bucketM !== null && (bucketM <= 0 || bucketM > 100_000)) {
        throw new Error('bucketM must be greater than 0 and at most 100000');
    }
    return { fromM, toM, ...(bucketM === null ? {} : { bucketM }) };
}

function parseInspectionFeatureListQuery(query = {}) {
    const limit = query.limit === undefined ? 1000 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
        throw new Error('limit must be an integer between 1 and 5000');
    }
    const range = parseViewportRange(query);
    const after = query.cursor === undefined || query.cursor === ''
        ? null
        : decodeAnchorCursor(query.cursor);
    return { ...range, limit, after };
}

function parseInspectionBucketQuery(query = {}) {
    const limit = query.limit === undefined ? 1500 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1500) {
        throw new Error('limit must be an integer between 1 and 1500');
    }
    return { ...parseViewportRange(query, { defaultBucketM: 100 }), limit };
}

function countWarnings(warnings) {
    return Object.values(asObject(warnings)).reduce((total, value) => {
        const count = asNonNegativeInteger(value, 0);
        return total + count;
    }, 0);
}

/**
 * How far a survey run has travelled. `ffs` means features were released to
 * fitness-for-service; `assessed` means an FFS run was completed and filed as
 * its own session, which is the only state that can produce an FFS report.
 */
function workflowStage(value) {
    return value === 'alignment' || value === 'runcomp' || value === 'ffs' || value === 'assessed'
        ? value
        : 'imported';
}

function serializeInspectionRun(row = {}) {
    const audit = asObject(row.ingestion_audit);
    const acceptedRows = asNonNegativeInteger(
        audit.accepted_rows,
        asNonNegativeInteger(row.row_count, 0),
    );
    const rejectedRows = asNonNegativeInteger(audit.rejected_rows, 0);
    const warningCount = countWarnings(audit.quality_warnings);
    const stage = workflowStage(row.workflow_stage);
    const evidenceStatus = acceptedRows === 0
        ? 'unavailable'
        : rejectedRows > 0 || warningCount > 0
            ? 'review'
            : 'ready';

    return {
        id: asNonNegativeInteger(row.id, 0),
        pipelineId: asNonNegativeInteger(row.pipeline_id, 0),
        pipelineName: typeof row.pipeline_name === 'string' ? row.pipeline_name : 'Unnamed pipeline',
        surveyYear: asNonNegativeInteger(row.survey_year),
        vendor: typeof row.vendor === 'string' ? row.vendor : null,
        sourceFile: typeof row.source_file === 'string' ? row.source_file : null,
        sourceObjectKey: typeof row.source_object_key === 'string' ? row.source_object_key : null,
        uploadedAt: row.uploaded_at || null,
        rowCount: asNonNegativeInteger(row.row_count, 0),
        provenance: {
            sourceSha256: typeof row.source_sha256 === 'string' ? row.source_sha256 : null,
            parserVersion: typeof row.parser_version === 'string' ? row.parser_version : null,
            schemaVersion: typeof row.schema_version === 'string' ? row.schema_version : null,
        },
        evidence: {
            status: evidenceStatus,
            sourceRows: asNonNegativeInteger(audit.source_rows),
            acceptedRows,
            rejectedRows,
            mappedColumns: asNonNegativeInteger(audit.mapped_columns),
            recognizedHeaderFields: asNonNegativeInteger(audit.recognized_header_fields),
            warningCount,
            warnings: asObject(audit.quality_warnings),
            numericCoercions: asObject(audit.numeric_coercions),
            rejectionReasons: asObject(audit.rejection_reasons),
        },
        workflow: {
            stage,
            alignmentSessionId: asNonNegativeInteger(row.workflow_session_id),
            ffsSessionId: asNonNegativeInteger(row.workflow_ffs_session_id),
            // The alignment workbook needs a completed alignment; the FFS
            // workbook needs a filed assessment. They are offered separately.
            downloadAvailable: stage === 'runcomp' || stage === 'ffs' || stage === 'assessed',
        },
    };
}

function coverage(populated, total) {
    if (!Number.isFinite(total) || total <= 0) return null;
    return Math.round((Math.max(0, populated) / total) * 10_000) / 100;
}

function serializeInspectionProfile(row = {}) {
    const featureCount = asNonNegativeInteger(row.feature_count, 0);
    const depthPopulated = asNonNegativeInteger(row.depth_populated, 0);
    const wallThicknessPopulated = asNonNegativeInteger(row.wall_thickness_populated, 0);
    const clockPopulated = asNonNegativeInteger(row.clock_populated, 0);

    return {
        runId: asNonNegativeInteger(row.id, 0),
        featureCount,
        distanceRangeM: {
            minimum: asFiniteNumber(row.minimum_distance_m),
            maximum: asFiniteNumber(row.maximum_distance_m),
        },
        coverage: {
            depthPercent: coverage(depthPopulated, featureCount),
            wallThicknessPercent: coverage(wallThicknessPopulated, featureCount),
            clockPositionPercent: coverage(clockPopulated, featureCount),
        },
        invalid: {
            missingFeatureType: asNonNegativeInteger(row.missing_feature_type, 0),
            depthOutOfRange: asNonNegativeInteger(row.invalid_depth, 0),
        },
    };
}

function serializeInspectionAnchor(row = {}) {
    const id = asNonNegativeInteger(row.id, 0);
    const runId = asNonNegativeInteger(row.run_id, 0);
    const distanceM = asFiniteNumber(row.log_distance_m);
    const featureType = typeof row.feature_type === 'string' && row.feature_type.trim()
        ? row.feature_type.trim()
        : typeof row.feature_identification === 'string' && row.feature_identification.trim()
            ? row.feature_identification.trim()
            : 'Other';
    const clock = typeof row.clock_position === 'string' && row.clock_position.trim()
        ? row.clock_position.trim()
        : null;
    const depth = asFiniteNumber(row.depth_pct);
    const length = asFiniteNumber(row.length_mm);
    const width = asFiniteNumber(row.width_mm);

    return {
        id: String(id),
        sourceKey: `run:${runId}:feature:${id}`,
        sourceFeatureId: typeof row.feature_id === 'string' ? row.feature_id : null,
        dist: distanceM,
        log_distance_m: distanceM,
        source_log_distance_m: distanceM,
        type: featureType,
        originalType: featureType,
        feature_type: featureType,
        feature_identification: typeof row.feature_identification === 'string'
            ? row.feature_identification
            : null,
        dist_to_us_gw_m: asFiniteNumber(row.dist_to_us_gw_m),
        joint_length_m: asFiniteNumber(row.joint_length_m),
        clock,
        clock_position: clock,
        depth,
        depth_pct: depth,
        length,
        length_mm: length,
        width,
        width_mm: width,
    };
}

function serializeInspectionFeature(row = {}) {
    const featureType = typeof row.feature_type === 'string' && row.feature_type.trim()
        ? row.feature_type.trim()
        : typeof row.feature_identification === 'string' && row.feature_identification.trim()
            ? row.feature_identification.trim()
            : 'Other';
    return {
        id: String(asNonNegativeInteger(row.id, 0)),
        sourceKey: `run:${asNonNegativeInteger(row.run_id, 0)}:feature:${asNonNegativeInteger(row.id, 0)}`,
        sourceFeatureId: typeof row.feature_id === 'string' ? row.feature_id : null,
        dist: asFiniteNumber(row.log_distance_m),
        log_distance_m: asFiniteNumber(row.log_distance_m),
        type: featureType,
        feature_type: featureType,
        feature_identification: typeof row.feature_identification === 'string' ? row.feature_identification : null,
        depth_pct: asFiniteNumber(row.depth_pct),
        length_mm: asFiniteNumber(row.length_mm),
        width_mm: asFiniteNumber(row.width_mm),
    };
}

function serializeInspectionBucket(row = {}) {
    return {
        bucketIndex: asNonNegativeInteger(row.bucket_index, 0),
        fromM: asFiniteNumber(row.bucket_from_m),
        toM: asFiniteNumber(row.bucket_to_m),
        featureCount: asNonNegativeInteger(row.feature_count, 0),
        anomalyCount: asNonNegativeInteger(row.anomaly_count, 0),
        maxDepthPct: asFiniteNumber(row.max_depth_pct),
        representativeType: typeof row.representative_type === 'string' ? row.representative_type : 'Other',
    };
}

module.exports = {
    parseInspectionAnchorListQuery,
    parseInspectionBucketQuery,
    parseInspectionFeatureListQuery,
    parseInspectionListQuery,
    serializeInspectionAnchor,
    serializeInspectionBucket,
    serializeInspectionFeature,
    serializeInspectionProfile,
    serializeInspectionRun,
};
