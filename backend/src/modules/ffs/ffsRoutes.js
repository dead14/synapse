const express = require('express');
const router = express.Router();
const ffsController = require('./ffsController');
const ffsCandidateController = require('./ffsCandidateController');
const ffsSessionController = require('./ffsSessionController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

router.get('/download-template', ffsController.downloadTemplate);

// Corrosion Analysis → FFS handoff. See docs/specs/ffs-alignment-gated-intake.md.
router.get('/ffs/eligible-sessions', authMiddleware, ffsCandidateController.listEligibleSessions);
router.get('/alignment-sessions/:id/ffs-candidates', authMiddleware, ffsCandidateController.getCandidates);
router.put('/alignment-sessions/:id/ffs-candidates', authMiddleware, ffsCandidateController.saveCandidates);

// Saved assessments. A completed FFS run is evidence, so it gets a session that
// can be listed, re-opened and exported rather than living in browser state.
router.post('/ffs/sessions', authMiddleware, ffsSessionController.createSession);
router.get('/ffs/sessions', authMiddleware, ffsSessionController.listSessions);
router.get('/ffs/sessions/:id', authMiddleware, ffsSessionController.getSession);
router.delete('/ffs/sessions/:id', authMiddleware, ffsSessionController.deleteSession);

module.exports = router;
