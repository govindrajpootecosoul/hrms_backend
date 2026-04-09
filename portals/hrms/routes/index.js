const express = require('express');
const router = express.Router();
router.use(require('./employees.routes'));
router.use(require('./attendance.routes'));
router.use(require('./leaves.routes'));
router.use(require('./leavePolicy.routes'));
router.use(require('./recruitment.routes'));
module.exports = router;
