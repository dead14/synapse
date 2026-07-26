const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { createRateLimiter } = require('../../middlewares/rateLimit');

const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
});

router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.getMe);

module.exports = router;
