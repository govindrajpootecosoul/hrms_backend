import express from 'express';
import { mockAttendance, mockLeaves, mockHolidays } from '../data/mockData';

const router = express.Router();

router.get('/', (req, res) => {
  const { employeeId, startDate, endDate } = req.query;
  
  let filtered = [...mockAttendance];

  if (employeeId) {
    filtered = filtered.filter(a => a.employeeId === employeeId);
  }

  if (startDate && endDate) {
    filtered = filtered.filter(a => a.date >= startDate && a.date <= endDate);
  }

  res.json(filtered);
});

router.post('/', (req, res) => {
  const newAttendance = {
    id: String(mockAttendance.length + 1),
    ...req.body,
  };
  mockAttendance.push(newAttendance);
  res.status(201).json(newAttendance);
});

router.get('/leaves', (req, res) => {
  const { employeeId, status } = req.query;
  
  let filtered = [...mockLeaves];

  if (employeeId) {
    filtered = filtered.filter(l => l.employeeId === employeeId);
  }

  if (status) {
    filtered = filtered.filter(l => l.status === status);
  }

  res.json(filtered);
});

router.post('/leaves', (req, res) => {
  const newLeave = {
    id: String(mockLeaves.length + 1),
    appliedDate: new Date().toISOString().split('T')[0],
    status: 'Pending',
    ...req.body,
  };
  mockLeaves.push(newLeave);
  res.status(201).json(newLeave);
});

router.put('/leaves/:id/approve', (req, res) => {
  const leave = mockLeaves.find(l => l.id === req.params.id);
  if (!leave) {
    return res.status(404).json({ error: 'Leave not found' });
  }
  leave.status = 'Approved';
  leave.approvedBy = req.body.approvedBy;
  leave.approvedDate = new Date().toISOString().split('T')[0];
  res.json(leave);
});

router.get('/holidays', (req, res) => {
  res.json(mockHolidays);
});

export default router;

