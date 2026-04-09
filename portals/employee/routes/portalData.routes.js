const express = require('express');
const router = express.Router();

const c = require('../controllers/portalDataController');

router.get('/dashboard', c.getDashboard);
router.get('/attendance', c.getAttendance);
router.get('/requests', c.getRequests);
router.get('/org', c.getOrg);
router.get('/reports', c.getReports);

module.exports = router;