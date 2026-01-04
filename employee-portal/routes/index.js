const express = require('express');
const router = express.Router();
const { connectMongo, getDb } = require('../../config/mongo');

// Helper: ensure a single doc exists per employeeId/type
async function getOrCreateDoc(collectionName, filter, defaultDoc) {
  const db = await getDb();
  const col = db.collection(collectionName);
  let doc = await col.findOne(filter);
  if (!doc) {
    await col.insertOne({ ...filter, ...defaultDoc, createdAt: new Date(), updatedAt: new Date() });
    doc = await col.findOne(filter);
  }
  return doc;
}

// Default data builders
const defaultDashboard = (employeeId = 'default') => ({
  employeeId,
  quickStats: {
    leaveBalance: 12,
    upcomingShift: '09:30 AM Tomorrow',
    pendingRequests: 1,
    lastPayout: 'Jan 5, 2025'
  },
  attendanceTrend: [
    { day: 'Mon', status: 'Present', hours: 8.2 },
    { day: 'Tue', status: 'Present', hours: 7.9 },
    { day: 'Wed', status: 'WFH', hours: 8.5 },
    { day: 'Thu', status: 'Present', hours: 8.1 },
    { day: 'Fri', status: 'Present', hours: 6.4 },
    { day: 'Sat', status: 'Weekend', hours: 0 },
    { day: 'Sun', status: 'Weekend', hours: 0 },
  ],
  announcements: [
    { id: 'ann1', title: 'FY25 Kickoff Townhall', date: '2025-01-21', type: 'event', audience: 'All employees' },
    { id: 'ann2', title: 'Cybersecurity Refresher Due Friday', date: '2025-01-17', type: 'reminder', audience: 'Product & Tech' },
    { id: 'ann3', title: 'People Pulse Survey Results', date: '2025-01-15', type: 'update', audience: 'Company-wide' },
  ],
  requestHistory: [
    { id: 'REQ-2831', type: 'Leave', status: 'Approved', submitted: 'Jan 12', details: '2 days - Personal errand' },
    { id: 'REQ-2842', type: 'WFH', status: 'Pending', submitted: 'Jan 15', details: 'Client calls from home' },
    { id: 'EXP-9921', type: 'Expense', status: 'Paid', submitted: 'Jan 08', details: 'Client dinner - ₹2,150' },
  ],
  assets: [
    { name: 'MacBook Pro 14"', tag: 'IT-45821', status: 'In Use' },
    { name: 'Access Card HQ-12F', tag: 'SEC-1893', status: 'In Use' },
  ],
  learningJourneys: [
    { id: 'lj1', title: 'AI for HR Leaders', progress: 68, due: 'Feb 28', badge: 'In progress' },
    { id: 'lj2', title: 'Advanced Presentation Storytelling', progress: 42, due: 'Mar 12', badge: 'New' },
    { id: 'lj3', title: 'Wellbeing Micro-habits', progress: 90, due: 'Feb 05', badge: 'Almost done' },
  ],
  kudos: [
    { id: 'k1', from: 'Priya S.', message: 'Thanks for stepping in on the West Coast client review!', date: 'Jan 17' },
    { id: 'k2', from: 'Rohit P.', message: 'Your demo deck helped us close the enterprise pilot.', date: 'Jan 14' },
  ],
  communityHighlights: [
    { id: 'ch1', title: 'Wellness Wednesday: Breathwork workshop', time: 'Jan 24 • 4:00 PM', location: 'Townhall' },
    { id: 'ch2', title: 'Product Jam: Ideas that shipped in Q4', time: 'Jan 27 • 11:30 AM', location: 'Zoom' },
  ],
});

const defaultAttendance = (employeeId = 'default') => ({
  employeeId,
  attendanceLast7Days: [
    { day: 'Mon', status: 'Present', hours: 8.2 },
    { day: 'Tue', status: 'Present', hours: 7.9 },
    { day: 'Wed', status: 'WFH', hours: 8.5 },
    { day: 'Thu', status: 'Present', hours: 8.1 },
    { day: 'Fri', status: 'Present', hours: 6.4 },
    { day: 'Sat', status: 'Weekend', hours: 0 },
    { day: 'Sun', status: 'Weekend', hours: 0 },
  ],
});

const defaultRequests = (employeeId = 'default') => ({
  employeeId,
  leaveBalances: [
    { type: 'Casual Leave', balance: 4 },
    { type: 'Sick Leave', balance: 3 },
    { type: 'Earned Leave', balance: 5 },
    { type: 'Work From Home', balance: 2 },
    { type: 'Compensatory Off', balance: 1 },
    { type: 'LOP', balance: 0 },
  ],
  recentRequests: [
    { id: 'REQ-2831', type: 'Leave', status: 'Approved', submitted: 'Jan 12', details: '2 days - Personal errand' },
    { id: 'REQ-2842', type: 'WFH', status: 'Pending', submitted: 'Jan 15', details: 'Client calls from home' },
    { id: 'EXP-9921', type: 'Expense', status: 'Paid', submitted: 'Jan 08', details: 'Client dinner - ₹2,150' },
  ]
});

const defaultOrg = () => ({
  departments: [
    {
      id: 'engineering',
      name: 'Engineering & Product',
      description: 'Responsible for building core platform capabilities, product experiences, and innovation initiatives.',
      headcount: 58,
      cxo: { name: 'Ananya Iyer', title: 'Chief Technology Officer' },
      directors: [
        { name: 'Rahul Verma', title: 'Director of Platform Engineering' },
        { name: 'Tanvi Kulkarni', title: 'Director of Product Engineering' },
      ],
      seniorManagers: [
        { name: 'Sneha Reddy', title: 'Senior Engineering Manager - Platform' },
        { name: 'Karthik Nayak', title: 'Senior Engineering Manager - Applications' },
      ],
      managers: [
        { name: 'Aditya Rao', title: 'Engineering Manager - Core APIs' },
        { name: 'Megha Sharma', title: 'Engineering Manager - Mobile Apps' },
      ],
      leads: [
        { name: 'Rohit Sinha', title: 'Tech Lead - Microservices' },
        { name: 'Neha Kapoor', title: 'Tech Lead - Frontend Guild' },
      ],
    },
    {
      id: 'people',
      name: 'People & Culture',
      description: 'Builds a people-first culture with focus on talent management, engagement, and compliance.',
      headcount: 24,
      cxo: { name: 'Leena Prakash', title: 'Chief People Officer' },
      directors: [{ name: 'Mansi Sheth', title: 'Director - Talent Success' }],
      seniorManagers: [
        { name: 'Arunima Bose', title: 'Senior HR Manager - Talent Development' },
        { name: 'Tarun Jha', title: 'Senior HR Manager - Total Rewards' },
      ],
      managers: [{ name: 'Shweta Purohit', title: 'HR Business Partner - Tech' }],
      leads: [{ name: 'Prerna Dixit', title: 'Lead - Culture & Engagement', focus: 'Programs' }],
    },
  ],
});

const defaultReports = () => ({
  reports: [
    { id: 'attendance', title: 'Attendance history', description: 'Daily presence, late marks, WFH logs.', formats: ['CSV', 'PDF'] },
    { id: 'expenses', title: 'Expense submissions', description: 'All non-advance and advance-based claims.', formats: ['CSV', 'XLSX'] },
    { id: 'requests', title: 'Leave & request log', description: 'Leaves, WFH, and support tickets filed.', formats: ['CSV'] },
  ],
});

// Dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId || 'default';
    const doc = await getOrCreateDoc('portal_dashboard', { employeeId }, defaultDashboard(employeeId));
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Attendance data
router.get('/attendance', async (req, res) => {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId || 'default';
    const doc = await getOrCreateDoc('portal_attendance', { employeeId }, defaultAttendance(employeeId));
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Requests data
router.get('/requests', async (req, res) => {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId || 'default';
    const doc = await getOrCreateDoc('portal_requests', { employeeId }, defaultRequests(employeeId));
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Requests error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Org data
router.get('/org', async (_req, res) => {
  try {
    await connectMongo();
    const doc = await getOrCreateDoc('portal_org', { key: 'org' }, defaultOrg());
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Org error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Reports data
router.get('/reports', async (_req, res) => {
  try {
    await connectMongo();
    const doc = await getOrCreateDoc('portal_reports', { key: 'reports' }, defaultReports());
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Check-in endpoint
router.post('/checkin', async (req, res) => {
  try {
    await connectMongo();
    const { employeeId } = req.body;
    
    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'Employee ID is required' });
    }

    console.log(`[checkin] Employee ${employeeId} attempting to check in`);

    const db = await getDb();
    const col = db.collection('employee_checkins');
    const today = new Date().toISOString().split('T')[0];
    
    // Check if already checked in today (and not checked out)
    const existing = await col.findOne({ 
      employeeId, 
      date: today,
      checkOutTime: null 
    });

    if (existing) {
      console.log(`[checkin] Employee ${employeeId} already checked in today`);
      return res.status(400).json({ 
        success: false, 
        error: 'Already checked in today. Please check out first.' 
      });
    }

    const checkInTime = new Date();
    const checkInDoc = {
      employeeId,
      date: today,
      checkInTime: checkInTime.toISOString(),
      checkOutTime: null,
      totalMinutes: 0,
      status: 'checked-in',
      createdAt: checkInTime,
      updatedAt: checkInTime
    };

    await col.insertOne(checkInDoc);
    console.log(`[checkin] Employee ${employeeId} checked in successfully at ${checkInTime.toISOString()}`);

    res.json({ 
      success: true, 
      message: 'Checked in successfully',
      data: {
        checkInTime: checkInDoc.checkInTime,
        status: 'checked-in',
        employeeId: employeeId
      }
    });
  } catch (err) {
    console.error('[checkin] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Check-out endpoint
router.post('/checkout', async (req, res) => {
  try {
    await connectMongo();
    const { employeeId } = req.body;
    
    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'Employee ID is required' });
    }

    console.log(`[checkout] Employee ${employeeId} attempting to check out`);

    const db = await getDb();
    const col = db.collection('employee_checkins');
    const today = new Date().toISOString().split('T')[0];
    
    // Find today's active check-in (not checked out yet)
    const checkIn = await col.findOne({ 
      employeeId, 
      date: today,
      checkOutTime: null 
    });

    if (!checkIn) {
      console.log(`[checkout] Employee ${employeeId} has no active check-in`);
      return res.status(400).json({ 
        success: false, 
        error: 'No active check-in found. Please check in first.' 
      });
    }

    const checkOutTime = new Date();
    const checkInTime = new Date(checkIn.checkInTime);
    const totalMinutes = Math.max(0, (checkOutTime.getTime() - checkInTime.getTime()) / 60000);

    await col.updateOne(
      { _id: checkIn._id },
      {
        $set: {
          checkOutTime: checkOutTime.toISOString(),
          totalMinutes: totalMinutes,
          status: 'checked-out',
          updatedAt: checkOutTime
        }
      }
    );

    console.log(`[checkout] Employee ${employeeId} checked out successfully. Total: ${totalMinutes.toFixed(2)} minutes`);

    res.json({ 
      success: true, 
      message: 'Checked out successfully',
      data: {
        checkOutTime: checkOutTime.toISOString(),
        totalMinutes: totalMinutes,
        totalHours: (totalMinutes / 60).toFixed(2),
        status: 'checked-out',
        employeeId: employeeId
      }
    });
  } catch (err) {
    console.error('[checkout] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get today's check-in status
router.get('/checkin/status', async (req, res) => {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId;
    
    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'Employee ID is required' });
    }

    const db = await getDb();
    const col = db.collection('employee_checkins');
    const today = new Date().toISOString().split('T')[0];
    
    // Find today's check-in record (most recent if multiple)
    const todayCheckIn = await col.findOne(
      { 
        employeeId, 
        date: today 
      },
      { sort: { checkInTime: -1 } } // Get most recent if multiple
    );

    if (!todayCheckIn) {
      return res.json({ 
        success: true, 
        data: {
          status: 'checked-out',
          checkInTime: null,
          checkOutTime: null,
          totalMinutes: 0,
          employeeId: employeeId
        }
      });
    }

    let totalMinutes = todayCheckIn.totalMinutes || 0;
    let status = todayCheckIn.status || 'checked-out';

    // If checked in but not checked out, calculate current minutes in real-time
    if (todayCheckIn.checkInTime && !todayCheckIn.checkOutTime) {
      const checkInTime = new Date(todayCheckIn.checkInTime);
      const now = new Date();
      totalMinutes = Math.max(0, (now.getTime() - checkInTime.getTime()) / 60000);
      status = 'checked-in';
    }

    res.json({ 
      success: true, 
      data: {
        status,
        checkInTime: todayCheckIn.checkInTime,
        checkOutTime: todayCheckIn.checkOutTime,
        totalMinutes: totalMinutes,
        employeeId: employeeId
      }
    });
  } catch (err) {
    console.error('[checkin/status] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get check-in history for an employee
router.get('/checkin/history', async (req, res) => {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId;
    const limit = parseInt(req.query.limit) || 30; // Default to last 30 records
    
    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'Employee ID is required' });
    }

    const db = await getDb();
    const col = db.collection('employee_checkins');
    
    const history = await col
      .find({ employeeId })
      .sort({ date: -1, checkInTime: -1 })
      .limit(limit)
      .toArray();

    res.json({ 
      success: true, 
      data: {
        employeeId,
        history: history.map(record => ({
          date: record.date,
          checkInTime: record.checkInTime,
          checkOutTime: record.checkOutTime,
          totalMinutes: record.totalMinutes,
          totalHours: record.totalMinutes ? (record.totalMinutes / 60).toFixed(2) : 0,
          status: record.status
        }))
      }
    });
  } catch (err) {
    console.error('[checkin/history] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
