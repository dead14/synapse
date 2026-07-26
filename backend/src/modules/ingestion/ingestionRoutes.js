const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const controller = require('./ingestionController');

const router = express.Router();
router.get('/:jobId', authMiddleware, controller.getIngestionJob);

module.exports = router;
