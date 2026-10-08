const express = require('express');
const router = express.Router();

const c = require('../controllers/adminUsersController');
const warehouseAttendance = require('../controllers/warehouseAttendanceController');
const { requireAuth, requireSuperAdmin } = require('../middlewares/auth');

// Force controller to operate on warehouse users collection
router.use((req, _res, next) => {
  req.usersCollectionType = 'warehouse';
  next();
});

// Warehouse daily attendance (CSV → MongoDB warehouse_employee_details)
router.get('/attendance', warehouseAttendance.listWarehouseAttendance);
router.post('/attendance/refresh', warehouseAttendance.refreshWarehouseAttendanceFromCsv);

router.get('/', c.listUsers);
router.get('/departments/list', c.listDepartments);
router.get('/departments/managers', c.listDepartmentManagers);
router.put('/departments/:department/manager', c.setDepartmentManager);
router.get('/ui/employees-columns', c.getEmployeesColumnsConfig);
router.put('/ui/employees-columns', requireAuth, requireSuperAdmin, c.setEmployeesColumnsConfig);
router.get('/:id', c.getUserById);
router.post('/', c.createUser);
router.put('/:id', c.updateUser);
router.delete('/:id', c.deleteUser);
router.patch('/:id/toggle-active', c.toggleActive);
router.get('/debug/info', c.debugInfo);
router.patch('/:id/portals', c.updatePortals);

module.exports = router;

