const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const controller = require('./directAssessmentController');
const router = express.Router();
router.get('/', authMiddleware, controller.list);
router.post('/', authMiddleware, controller.create);
router.patch('/:id/phase', authMiddleware, controller.advance);
router.post('/:id/cp-surveys', authMiddleware, controller.addCpSurvey);
module.exports = router;
