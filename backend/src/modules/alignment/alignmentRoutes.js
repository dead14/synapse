const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const alignmentController = require('./alignmentController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

const upload = multer({ dest: path.join(__dirname, '../../../uploads/') });

router.post('/upload-csv', authMiddleware, upload.single('file'), alignmentController.uploadCsv);
router.post('/run', authMiddleware, alignmentController.runAlignment);
router.post('/align-dtw', authMiddleware, alignmentController.runDtwAlignment);

// Wizard State Persistence
router.post('/wizard/save', authMiddleware, alignmentController.saveWizardState);
router.post('/wizard/save-sections', authMiddleware, alignmentController.saveSections);
router.get('/wizard/resume', authMiddleware, alignmentController.resumeWizardState);
router.get('/wizard/session/:id', authMiddleware, alignmentController.getWizardSession);
router.get('/pipeline-runs', authMiddleware, alignmentController.getPipelineRuns);


router.get('/ili-results', authMiddleware, alignmentController.getIliResults);
router.get('/results/:runId', authMiddleware, alignmentController.getAlignmentResults);

module.exports = router;
