const express = require('express');
const router = express.Router();

const c = require('../controllers/attendanceRequestsController');

router.post('/attendance-request', c.submitAttendanceRequest);
router.get('/attendance-requests', c.listAttendanceRequests);

module.exports = router;