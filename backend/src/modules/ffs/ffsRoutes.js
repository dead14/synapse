const express = require('express');
const router = express.Router();
const ffsController = require('./ffsController');
const ffsCandidateController = require('./ffsCandidateController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

router.get('/download-template', ffsController.downloadTemplate);

// Corrosion Analysis → FFS handoff. See docs/specs/ffs-alignment-gated-intake.md.
router.get('/ffs/eligible-sessions', authMiddleware, ffsCandidateController.listEligibleSessions);
router.get('/alignment-sessions/:id/ffs-candidates', authMiddleware, ffsCandidateController.getCandidates);
router.put('/alignment-sessions/:id/ffs-candidates', authMiddleware, ffsCandidateController.saveCandidates);

module.exports = router;
