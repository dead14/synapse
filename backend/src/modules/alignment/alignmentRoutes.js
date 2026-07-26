const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const alignmentController = require('./alignmentController');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const {
    authenticatedUserKey,
    createRedisRateLimiter,
    integerFromEnv,
} = require('../../middlewares/redisRateLimit');

// Strict per-user budgets for the expensive alignment endpoints, attached
// after authMiddleware so req.user keys them.  Each adds one Redis roundtrip
// on top of the global /api limiter (two total on these routes) — accepted
// so the limiters stay independent.  Redis outages fail open.
const strictWindowMs = integerFromEnv('RATE_LIMIT_STRICT_WINDOW_MS', 60_000);
function strictRouteLimiter(routeName, envName, defaultMax) {
    return createRedisRateLimiter({
        prefix: `rl:route:${routeName}`,
        windowMs: strictWindowMs,
        max: integerFromEnv(envName, defaultMax),
        keyGenerator: authenticatedUserKey,
    });
}
const uploadCsvLimiter = strictRouteLimiter('upload-csv', 'RATE_LIMIT_UPLOAD_CSV_MAX', 10);
const runLimiter = strictRouteLimiter('run', 'RATE_LIMIT_RUN_MAX', 10);
const alignDtwLimiter = strictRouteLimiter('align-dtw', 'RATE_LIMIT_ALIGN_DTW_MAX', 30);
const tieInOffsetLimiter = strictRouteLimiter('estimate-tiein-offset', 'RATE_LIMIT_TIEIN_OFFSET_MAX', 30);
const iliResultsLimiter = strictRouteLimiter('ili-results', 'RATE_LIMIT_ILI_RESULTS_MAX', 60);

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

// The upload limiter sits before multer so a throttled request is rejected
// without buffering its file to disk first.
router.post('/upload-csv', authMiddleware, uploadCsvLimiter, upload.single('file'), alignmentController.uploadCsv);
router.get('/alignment/strategies', authMiddleware, alignmentController.listAlignmentStrategies);
router.post('/run', authMiddleware, runLimiter, alignmentController.runAlignment);
router.post('/align-dtw', authMiddleware, alignDtwLimiter, alignmentController.runDtwAlignment);
router.post('/estimate-tiein-offset', authMiddleware, tieInOffsetLimiter, alignmentController.estimateTieInOffset);

// Wizard State Persistence
router.post('/wizard/save', authMiddleware, alignmentController.saveWizardState);
router.post('/wizard/save-sections', authMiddleware, alignmentController.saveSections);
router.post('/wizard/save-intervention', authMiddleware, alignmentController.saveIntervention);
router.get('/wizard/resume', authMiddleware, alignmentController.resumeWizardState);
router.get('/wizard/session/:id', authMiddleware, alignmentController.getWizardSession);
router.get('/pipeline-runs', authMiddleware, alignmentController.getPipelineRuns);
router.delete('/pipeline-runs/:id', authMiddleware, alignmentController.deletePipelineRun);


router.get('/ili-results', authMiddleware, iliResultsLimiter, alignmentController.getIliResults);
router.get('/results/:runId', authMiddleware, alignmentController.getAlignmentResults);
router.get('/results/:runId/page', authMiddleware, alignmentController.getAlignmentResultsPage);
router.post('/alignment/export-excel', authMiddleware, alignmentController.exportExcel);
router.get('/job/:jobId/result', authMiddleware, alignmentController.getJobResult);

module.exports = router;
