const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const alignmentController = require('./alignmentController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

const allowedExtensions = new Set(['.csv', '.xlsx']);
const allowedMimeTypes = new Set([
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
    dest: path.join(__dirname, '../../../uploads/'),
    limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES) || 25 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        const extension = path.extname(file.originalname || '').toLowerCase();
        if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(file.mimetype)) {
            return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
        }
        return callback(null, true);
    },
});

router.post('/upload-csv', authMiddleware, upload.single('file'), alignmentController.uploadCsv);
router.post('/run', authMiddleware, alignmentController.runAlignment);
router.post('/align-dtw', authMiddleware, alignmentController.runDtwAlignment);
router.post('/estimate-tiein-offset', authMiddleware, alignmentController.estimateTieInOffset);

// Wizard State Persistence
router.post('/wizard/save', authMiddleware, alignmentController.saveWizardState);
router.post('/wizard/save-sections', authMiddleware, alignmentController.saveSections);
router.post('/wizard/save-intervention', authMiddleware, alignmentController.saveIntervention);
router.get('/wizard/resume', authMiddleware, alignmentController.resumeWizardState);
router.get('/wizard/session/:id', authMiddleware, alignmentController.getWizardSession);
router.get('/pipeline-runs', authMiddleware, alignmentController.getPipelineRuns);
router.delete('/pipeline-runs/:id', authMiddleware, alignmentController.deletePipelineRun);


router.get('/ili-results', authMiddleware, alignmentController.getIliResults);
router.get('/results/:runId', authMiddleware, alignmentController.getAlignmentResults);
router.get('/results/:runId/page', authMiddleware, alignmentController.getAlignmentResultsPage);
router.post('/alignment/export-excel', authMiddleware, alignmentController.exportExcel);
router.get('/job/:jobId/result', authMiddleware, alignmentController.getJobResult);

module.exports = router;
