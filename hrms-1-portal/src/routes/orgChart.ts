import express from 'express';
import { mockEmployees, mockDepartments } from '../data/mockData';

const router = express.Router();

router.get('/', (req, res) => {
  // Build organizational hierarchy
  const orgStructure = {
    ceo: {
      id: 'CEO',
      name: 'CEO',
      role: 'Chief Executive Officer',
      children: mockDepartments.map(dept => ({
        id: dept.id,
        name: dept.name,
        head: dept.head,
        type: 'department',
        children: mockEmployees
          .filter(emp => emp.department === dept.name)
          .map(emp => ({
            id: emp.id,
            name: emp.name,
            employeeId: emp.employeeId,
            designation: emp.designation,
            type: 'employee',
          })),
      })),
    },
  };

  res.json(orgStructure);
});

router.get('/departments', (req, res) => {
  res.json(mockDepartments);
});

export default router;

