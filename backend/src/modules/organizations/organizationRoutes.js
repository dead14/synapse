const express = require('express');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { listOrganizations } = require('./organizationController');

const router = express.Router();

router.get('/', authMiddleware, listOrganizations);

module.exports = router;
