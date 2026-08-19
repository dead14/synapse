const express = require('express');
const router = express.Router();
const pipelineController = require('./pipelineController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

// The pipeline dossier: the line's design data, filed once and read by every
// assessment. See docs/specs/pipeline-dossier.md.
router.get('/pipelines', authMiddleware, pipelineController.listPipelines);
router.get('/pipelines/:id/specification', authMiddleware, pipelineController.getSpecification);
router.put('/pipelines/:id/specification', authMiddleware, pipelineController.saveSpecification);

module.exports = router;
