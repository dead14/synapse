const express = require('express');
const router = express.Router();
const userController = require('./userController');
const { authMiddleware, requireAdmin } = require('../../middlewares/authMiddleware');

router.get('/', authMiddleware, userController.getUsers);
router.post('/', authMiddleware, requireAdmin, userController.createUser);
router.put('/:id/reset-password', authMiddleware, requireAdmin, userController.resetPassword);
router.put('/:id/toggle-status', authMiddleware, requireAdmin, userController.toggleStatus);

module.exports = router;
