const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const inspectionController = require('./inspectionController');

const router = express.Router();

router.get('/', authMiddleware, inspectionController.listInspectionRuns);
router.get('/:id/features', authMiddleware, inspectionController.listInspectionFeatures);
router.get('/:id/buckets', authMiddleware, inspectionController.listInspectionBuckets);
router.get('/:id/anchors', authMiddleware, inspectionController.listInspectionAnchors);
router.get('/:id/profile', authMiddleware, inspectionController.getInspectionProfile);

module.exports = router;
