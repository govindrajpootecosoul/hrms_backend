const express = require('express');
const router = express.Router();

router.use(require('./portalData.routes'));
router.use(require('./checkin.routes'));
router.use(require('./attendanceRequests.routes'));
router.use(require('./machineAttendance.routes'));
router.use(require('./notifications.routes'));

const profile = require('../controllers/employeeProfileController');
router.get('/profile', profile.getProfile);

module.exports = router;