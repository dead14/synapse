/**
 * What the browser may file as a pipeline dossier.
 *
 * Every number crossing this boundary is already canonical — millimetres and
 * megapascals — because the screens offer inches and psi and the stored record
 * must not depend on which unit was selected when it was typed. A field left
 * blank stays null: "not recorded" is an answer an assessment has to be able to
 * read, and a defaulted zero is not the same thing.
 */

const MAX_SEGMENTS = 40;

/** Diameters below this are fittings or instrument tubing, not line pipe. */
const MIN_OUTER_DIAMETER_MM = 50;

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value, field, maximum) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error(`${field} must be text`);
    const text = value.trim();
    if (text === '') return null;
    if (text.length > maximum) throw new Error(`${field} must be ${maximum} characters or fewer`);
    return text;
}

function requiredText(value, field, maximum) {
    const text = optionalText(value, field, maximum);
    if (text === null) throw new Error(`${field} is required`);
    return text;
}

/**
 * A finite number inside its physical range, or null.
 *
 * `''`, null and undefined all mean "not recorded". A value that is present but
 * unusable is an error rather than a silent null, so a typo cannot quietly
 * erase a line record the engineer believes they just saved.
 */
function optionalNumber(value, field, { min = null, max = null } = {}) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${field} must be a number`);
    if (min !== null && number < min) throw new Error(`${field} must be at least ${min}`);
    if (max !== null && number > max) throw new Error(`${field} must be at most ${max}`);
    return number;
}

function optionalYear(value, field) {
    const year = optionalNumber(value, field, { min: 1900, max: 2100 });
    if (year === null) return null;
    if (!Number.isInteger(year)) throw new Error(`${field} must be a four-digit year`);
    return year;
}

/** The pipe fields a stretch and the line itself describe the same way. */
function parsePipeFields(value, label) {
    return {
        outerDiameterMm: optionalNumber(value.outerDiameterMm, `${label} outer diameter`, {
            min: MIN_OUTER_DIAMETER_MM, max: 3_000,
        }),
        nominalWallThicknessMm: optionalNumber(
            value.nominalWallThicknessMm, `${label} nominal wall thickness`, { min: 0.1, max: 200 },
        ),
        smysMpa: optionalNumber(value.smysMpa, `${label} SMYS`, { min: 1, max: 2_000 }),
        designFactor: optionalNumber(value.designFactor, `${label} design factor`, {
            min: 0.01, max: 1,
        }),
        materialGrade: optionalText(value.materialGrade, `${label} material grade`, 60),
        seamType: optionalText(value.seamType, `${label} seam type`, 60),
    };
}

/**
 * Wall past half the diameter leaves no bore.
 *
 * Diameter and wall sit side by side on every screen that collects them and are
 * easy to transpose. Caught here rather than as a NaN in the Folias term
 * partway down an assessment.
 */
function assertPipeGeometry(pipe, label) {
    if (pipe.outerDiameterMm === null || pipe.nominalWallThicknessMm === null) return;
    if (pipe.outerDiameterMm <= 2 * pipe.nominalWallThicknessMm) {
        throw new Error(`${label} wall thickness leaves no bore at that outer diameter`);
    }
}

function parseSegment(value, index) {
    if (!isRecord(value)) throw new Error(`Segment ${index + 1} must be an object`);
    const label = `Segment ${index + 1}`;
    const pipe = parsePipeFields(value, label);
    assertPipeGeometry(pipe, label);

    const startM = optionalNumber(value.startM, `${label} start`, { min: 0, max: 5_000_000 });
    const endM = optionalNumber(value.endM, `${label} end`, { min: 0, max: 5_000_000 });
    if (startM !== null && endM !== null && endM <= startM) {
        throw new Error(`${label} must end after it starts`);
    }

    return {
        position: index,
        label: requiredText(value.label ?? label, `${label} name`, 120),
        startM,
        endM,
        ...pipe,
    };
}

function parseSegments(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('segments must be an array');
    if (value.length > MAX_SEGMENTS) {
        throw new Error(`A pipeline may carry at most ${MAX_SEGMENTS} segments`);
    }
    return value.map(parseSegment);
}

function parsePipelineSpecification(body) {
    if (!isRecord(body)) throw new Error('request body must be an object');

    const pipe = parsePipeFields(body, 'Line');
    assertPipeGeometry(pipe, 'Line');

    return {
        environment: optionalText(body.environment, 'environment', 60),
        productMedium: optionalText(body.productMedium, 'product medium', 60),
        lengthKm: optionalNumber(body.lengthKm, 'pipe length', { min: 0, max: 5_000 }),
        locationClass: optionalText(body.locationClass, 'location class', 40),
        installationYear: optionalYear(body.installationYear, 'installation year'),
        commissioningYear: optionalYear(body.commissioningYear, 'commissioning year'),
        designLifeYears: optionalNumber(body.designLifeYears, 'design life', { min: 0, max: 200 }),
        ...pipe,
        externalCoating: optionalText(body.externalCoating, 'external coating', 60),
        maopMpa: optionalNumber(body.maopMpa, 'MAOP', { min: 0, max: 100 }),
        designPressureMpa: optionalNumber(body.designPressureMpa, 'design pressure', { min: 0, max: 100 }),
        operatingPressureMpa: optionalNumber(
            body.operatingPressureMpa, 'operating pressure', { min: 0, max: 100 },
        ),
        internalDesignPressureMpa: optionalNumber(
            body.internalDesignPressureMpa, 'internal design pressure', { min: 0, max: 100 },
        ),
        weldJointFactor: optionalNumber(body.weldJointFactor, 'weld joint factor', { min: 0.1, max: 1 }),
        yieldToTensileRatio: optionalNumber(
            body.yieldToTensileRatio, 'yield-to-tensile ratio', { min: 0.1, max: 1 },
        ),
        notes: optionalText(body.notes, 'notes', 2_000),
        segments: parseSegments(body.segments),
    };
}

module.exports = {
    MAX_SEGMENTS,
    MIN_OUTER_DIAMETER_MM,
    parsePipelineSpecification,
};
