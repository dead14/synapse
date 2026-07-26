const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const controller = require('./integrityController');

const router = express.Router();
router.get('/', authMiddleware, controller.listCases);
router.post('/', authMiddleware, controller.createCase);
router.get('/:id', authMiddleware, controller.getCase);
router.patch('/:id/stage', authMiddleware, controller.advanceCase);
router.post('/:id/approvals', authMiddleware, controller.createApproval);
router.post('/:id/repair-plans', authMiddleware, controller.createRepairPlan);
router.post('/:id/evidence', authMiddleware, controller.createEvidence);
router.patch('/evidence/:evidenceId/status', authMiddleware, controller.transitionEvidence);
module.exports = router;
