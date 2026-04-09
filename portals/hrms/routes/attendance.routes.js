const express = require('express');
const router = express.Router();
const c = require('../controllers/attendanceController');
router.get('/attendance', c.listAttendance);
router.get('/attendance/stats', c.attendanceStats);
module.exports = router;
