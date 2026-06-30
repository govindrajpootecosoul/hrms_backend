const express = require('express');
const router = express.Router();

const c = require('../controllers/portalDataController');
const reportsExport = require('../controllers/reportsExportController');
const team = require('../controllers/departmentTeamController');

router.get('/dashboard', c.getDashboard);
router.get('/department-team', team.getDepartmentTeam);
router.get('/attendance', c.getAttendance);
router.get('/requests', c.getRequests);
router.get('/org', c.getOrg);
router.get('/reports', c.getReports);
router.get('/reports/attendance/export', reportsExport.exportAttendanceReport);
router.get('/reports/requests/export', reportsExport.exportRequestsReport);

module.exports = router;