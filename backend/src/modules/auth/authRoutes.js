const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { createRateLimiter } = require('../../middlewares/rateLimit');
const {
    authRequestKeys,
    createRedisRateLimiter,
    integerFromEnv,
} = require('../../middlewares/redisRateLimit');

const authWindowMs = integerFromEnv('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000);
const authMax = integerFromEnv('RATE_LIMIT_AUTH_MAX', 10);

// Redis enforces the budget across processes and per (ip, email) dimension.
// When Redis is unavailable the limiter fails open into the original
// in-process per-IP limiter, so login/register never go fully unthrottled.
const authRateLimiter = createRedisRateLimiter({
    prefix: 'rl:auth',
    windowMs: authWindowMs,
    max: authMax,
    keyGenerator: authRequestKeys,
    fallback: createRateLimiter({ windowMs: authWindowMs, max: authMax }),
});

router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.getMe);

module.exports = router;
