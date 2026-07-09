const express = require('express');
const router = express.Router();
const ffsController = require('./ffsController');

router.get('/download-template', ffsController.downloadTemplate);

module.exports = router;
