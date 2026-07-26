const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const controller = require('./complianceController');
const router = express.Router();
router.get('/requirements', authMiddleware, controller.listRequirements);
router.post('/requirements', authMiddleware, controller.createRequirement);
module.exports = router;
