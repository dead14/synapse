const pool = require('../../config/db');
const { parseCreateFieldMeasurement, parseFieldMeasurementListQuery } = require('./fieldMeasurementContract');
const { createOwnedFieldMeasurement, listOwnedFieldMeasurements } = require('./fieldMeasurementRepository');

exports.create = async (req, res) => {
    try {
        const input = parseCreateFieldMeasurement(req.body);
        const measurement = await createOwnedFieldMeasurement(pool, req.user.orgId, req.user.id, input);
        if (!measurement) return res.status(404).json({ error: 'Integrity case, run, or feature not found in organization' });
        return res.status(201).json(measurement);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_FIELD_MEASUREMENT' });
    }
};

exports.list = async (req, res) => {
    try {
        const page = await listOwnedFieldMeasurements(pool, req.user.orgId, parseFieldMeasurementListQuery(req.query));
        return res.json({ items: page.rows, nextCursor: page.nextCursor });
    } catch (error) {
        return res.status(400).json({ error: error.message, code: 'INVALID_FIELD_MEASUREMENT_QUERY' });
    }
};
