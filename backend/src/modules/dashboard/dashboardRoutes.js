const express = require('express');
const router = express.Router();
const dashboardController = require('./dashboardController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

router.get('/activity-logs', authMiddleware, dashboardController.getActivityLogs);
router.get('/stats', authMiddleware, dashboardController.getDashboardStats);

module.exports = router;
