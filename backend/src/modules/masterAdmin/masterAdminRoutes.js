const express = require('express');
const { authMiddleware, requireSuperAdmin } = require('../../middlewares/authMiddleware');
const controller = require('./masterAdminController');

const router = express.Router();
router.use(authMiddleware, requireSuperAdmin);
router.get('/overview', controller.getOverview);
router.get('/organizations', controller.getOrganizations);
router.patch('/organizations/:id/limits', controller.updateOrganizationLimits);
router.get('/audit-logs', controller.getAuditLogs);
router.get('/password-resets', controller.getPasswordResetRequests);
router.post('/password-resets/:id/resolve', controller.resolvePasswordReset);

module.exports = router;
