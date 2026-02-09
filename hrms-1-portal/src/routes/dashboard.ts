import express from 'express';
import { mockEmployees, mockAttendance, mockLeaves, mockDepartments } from '../data/mockData';

const router = express.Router();

router.get('/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const totalEmployees = mockEmployees.length;
  const activeEmployees = mockEmployees.filter(e => e.status === 'Active').length;
  const todayAttendance = mockAttendance.filter(a => a.date === today && a.status === 'Present').length;
  const pendingLeaves = mockLeaves.filter(l => l.status === 'Pending').length;
  
  // Upcoming birthdays (next 30 days)
  const todayDate = new Date();
  const nextMonth = new Date(todayDate);
  nextMonth.setMonth(todayDate.getMonth() + 1);
  
  const upcomingBirthdays = mockEmployees.filter(emp => {
    const dob = new Date(emp.dob);
    const thisYearBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
    return thisYearBirthday >= todayDate && thisYearBirthday <= nextMonth;
  }).length;

  res.json({
    totalEmployees,
    activeEmployees,
    todayAttendance,
    pendingLeaves,
    upcomingBirthdays,
  });
});

router.get('/department-distribution', (req, res) => {
  const distribution = mockDepartments.map(dept => ({
    name: dept.name,
    value: dept.employeeCount,
  }));

  res.json(distribution);
});

router.get('/attendance-trends', (req, res) => {
  const activeEmployees = mockEmployees.filter(e => e.status === 'Active').length;
  
  // Mock attendance trends for last 7 days
  const trends = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const dateStr = date.toISOString().split('T')[0];
    const present = mockAttendance.filter(a => a.date === dateStr && a.status === 'Present').length;
    return {
      date: dateStr,
      present,
      absent: activeEmployees - present,
    };
  });

  res.json(trends);
});

router.get('/recent-activities', (req, res) => {
  const activities = [
    { id: '1', type: 'New Hire', description: 'Jane Smith joined Sales department', date: '2024-01-10' },
    { id: '2', type: 'Leave Approved', description: 'John Doe\'s leave approved', date: '2024-01-12' },
    { id: '3', type: 'Resignation', description: 'Employee resigned from Engineering', date: '2024-01-14' },
  ];

  res.json(activities);
});

router.get('/upcoming-events', (req, res) => {
  const events = [
    { id: '1', type: 'Interview', title: 'Interview - Senior Software Engineer', date: '2024-01-20', time: '10:00 AM' },
    { id: '2', type: 'Training', title: 'HR Training Session', date: '2024-01-22', time: '2:00 PM' },
  ];

  res.json(events);
});

export default router;

