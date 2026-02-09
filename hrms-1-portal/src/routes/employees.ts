import express from 'express';
import { mockEmployees } from '../data/mockData';

const router = express.Router();

// Get all employees
router.get('/', (req, res) => {
  const { search, department, status } = req.query;
  
  let filtered = [...mockEmployees];

  if (search) {
    const searchLower = (search as string).toLowerCase();
    filtered = filtered.filter(emp => 
      emp.name.toLowerCase().includes(searchLower) ||
      emp.employeeId.toLowerCase().includes(searchLower) ||
      emp.email.toLowerCase().includes(searchLower)
    );
  }

  if (department) {
    filtered = filtered.filter(emp => emp.department === department);
  }

  if (status) {
    filtered = filtered.filter(emp => emp.status === status);
  }

  res.json(filtered);
});

// Get employee by ID
router.get('/:id', (req, res) => {
  const employee = mockEmployees.find(e => e.id === req.params.id || e.employeeId === req.params.id);
  
  if (!employee) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  res.json(employee);
});

// Create employee
router.post('/', (req, res) => {
  const newEmployee = {
    id: String(mockEmployees.length + 1),
    employeeId: `EMP${String(mockEmployees.length + 1).padStart(3, '0')}`,
    ...req.body,
  };

  mockEmployees.push(newEmployee);
  res.status(201).json(newEmployee);
});

// Update employee
router.put('/:id', (req, res) => {
  const index = mockEmployees.findIndex(e => e.id === req.params.id || e.employeeId === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  mockEmployees[index] = { ...mockEmployees[index], ...req.body };
  res.json(mockEmployees[index]);
});

// Delete employee
router.delete('/:id', (req, res) => {
  const index = mockEmployees.findIndex(e => e.id === req.params.id || e.employeeId === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  mockEmployees.splice(index, 1);
  res.json({ success: true });
});

export default router;

