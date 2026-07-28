const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { createRateLimiter } = require('../../middlewares/rateLimit');
const {
    createRedisRateLimiter,
    integerFromEnv,
} = require('../../middlewares/redisRateLimit');
const controller = require('./publicShareController');
const { requireSharePublisher } = require('./publicShareSecurity');

const router = express.Router();
const publicWindowMs = integerFromEnv('RATE_LIMIT_PUBLIC_SHARE_WINDOW_MS', 60_000);
const publicMax = integerFromEnv('RATE_LIMIT_PUBLIC_SHARE_MAX', 120);
const publicFallback = createRateLimiter({
    windowMs: publicWindowMs,
    max: publicMax,
});
const publicReadLimiter = createRedisRateLimiter({
    prefix: 'rl:public-share',
    windowMs: publicWindowMs,
    max: publicMax,
    keyGenerator: (req) => `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`,
    fallback: publicFallback,
});

// This is the only anonymous result route. It is intentionally GET-only.
router.get('/:id', publicReadLimiter, controller.getPublic);

router.use(authMiddleware, requireSharePublisher);
router.get('/', controller.list);
router.post('/', controller.create);
router.delete('/:id', controller.revoke);

module.exports = router;
