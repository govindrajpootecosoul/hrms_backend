import express from 'express';
import { mockEmployees, mockAttendance, mockLeaves } from '../data/mockData';

const router = express.Router();

router.get('/employee-summary', (req, res) => {
  const { department } = req.query;
  
  let filtered = [...mockEmployees];
  if (department) {
    filtered = filtered.filter(e => e.department === department);
  }

  const summary = filtered.map(emp => ({
    employeeId: emp.employeeId,
    name: emp.name,
    department: emp.department,
    designation: emp.designation,
    status: emp.status,
    joiningDate: emp.joiningDate,
  }));

  res.json(summary);
});

router.get('/attendance-summary', (req, res) => {
  const { startDate, endDate } = req.query;
  
  let filtered = [...mockAttendance];
  if (startDate && endDate) {
    filtered = filtered.filter(a => a.date >= startDate && a.date <= endDate);
  }

  res.json(filtered);
});

router.get('/leave-summary', (req, res) => {
  const { startDate, endDate } = req.query;
  
  let filtered = [...mockLeaves];
  if (startDate && endDate) {
    filtered = filtered.filter(l => l.startDate >= startDate && l.endDate <= endDate);
  }

  res.json(filtered);
});

export default router;

