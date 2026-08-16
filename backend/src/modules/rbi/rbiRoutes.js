const express = require('express');
const router = express.Router();
const rbiSessionController = require('./rbiSessionController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

// API 580 assessments. §16.2 asks for a record complete enough that someone who
// was not in the room can recreate the assessment, and recommends holding it in
// a database — so an assessment is a session that can be listed, re-opened,
// re-saved, issued, and exported, not a form that lives until the tab closes.
router.post('/rbi/sessions', authMiddleware, rbiSessionController.createSession);
router.get('/rbi/sessions', authMiddleware, rbiSessionController.listSessions);
router.get('/rbi/sessions/:id', authMiddleware, rbiSessionController.getSession);
router.put('/rbi/sessions/:id', authMiddleware, rbiSessionController.updateSession);
router.delete('/rbi/sessions/:id', authMiddleware, rbiSessionController.deleteSession);

module.exports = router;
