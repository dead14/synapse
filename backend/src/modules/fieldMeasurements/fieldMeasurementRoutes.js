const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const controller = require('./fieldMeasurementController');

const router = express.Router();
router.get('/', authMiddleware, controller.list);
router.post('/', authMiddleware, controller.create);

module.exports = router;
