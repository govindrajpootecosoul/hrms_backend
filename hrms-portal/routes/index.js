const express = require('express');
const router = express.Router();
const { connectMongo, getDb, getEmployeePortalDb } = require('../../config/mongo');
const { getCompanyDatabaseName } = require('../../config/database.config');

/**
 * Get company from request (query parameter or header)
 */
function getCompanyFromRequest(req) {
  return req.query.company || req.headers['x-company'] || null;
}

/**
 * Get HRMS database (company-specific)
 */
async function getHrmsDb(company = null) {
  await connectMongo();
  if (!company) {
    const { getDatabaseName } = require('../../config/database.config');
    return (await getDb(getDatabaseName('hrms')));
  }
  const dbName = getCompanyDatabaseName('hrms', company);
  const { MongoClient } = require('mongodb');
  const { getMongoUri } = require('../../config/app.config');
  const uri = getMongoUri();
  const client = new MongoClient(uri);
  await client.connect();
  return client.db(dbName);
}

/**
 * Get Employee database (company-specific) - for accessing attendance requests
 */
async function getEmployeeDbForHrms(company = null) {
  await connectMongo();
  if (!company) {
    const { getDatabaseName } = require('../../config/database.config');
    return (await getDb(getDatabaseName('employee')));
  }
  return await getEmployeePortalDb(company);
}

// HRMS Portal Routes
// All HRMS-related endpoints will be defined here

// Get all employees
router.get('/employees', async (req, res) => {
  try {
    await connectMongo();
    let company = getCompanyFromRequest(req);
    const { search, department, status } = req.query;
    
    // Normalize company name
    if (!company || company === '1' || company === 'undefined') {
      company = 'Ecosoul Home';
    }
    
    // Get users collection based on company
    const { getUsersCollection } = require('../../config/mongo');
    let usersCol;
    let totalCount = 0;
    
    try {
      usersCol = await getUsersCollection(null, company);
      totalCount = await usersCol.countDocuments({});
      
      // If count is 0, try the other company collection
      if (totalCount === 0) {
        const otherCompany = company === 'Ecosoul Home' ? 'Thrive' : 'Ecosoul Home';
        const otherUsersCol = await getUsersCollection(null, otherCompany);
        const otherCount = await otherUsersCol.countDocuments({});
        if (otherCount > 0) {
          usersCol = otherUsersCol;
          company = otherCompany;
          totalCount = otherCount;
          console.log(`[employees] Found ${totalCount} employees in ${otherCompany} collection`);
        }
      }
    } catch (err) {
      console.error(`[employees] Error getting employees for ${company}:`, err);
      // Try default collection
      usersCol = await getUsersCollection(null, 'Ecosoul Home');
    }
    
    // Build query
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (department) {
      query.department = department;
    }
    
    if (status) {
      query.status = status;
    }
    
    // Fetch employees
    const employees = await usersCol.find(query).toArray();
    
    // Transform to frontend format
    const formattedEmployees = employees.map(emp => ({
      id: emp._id.toString(),
      employeeId: emp.employeeId || emp.email?.split('@')[0] || 'N/A',
      name: emp.name || emp.firstName || 'Unknown',
      email: emp.email || '',
      department: emp.department || 'General',
      designation: emp.designation || emp.role || 'Employee',
      status: emp.status || 'active',
      phone: emp.phone || emp.mobile || '',
      joiningDate: emp.joiningDate || emp.createdAt || null,
      location: emp.location || '',
      biometricId: emp.biometricId || emp.employeeId || ''
    }));
    
    res.json({
      success: true,
      data: {
        employees: formattedEmployees,
        total: formattedEmployees.length
      }
    });
  } catch (error) {
    console.error('HRMS employees error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get all employees attendance data
router.get('/attendance', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const date = req.query.date || new Date().toISOString().split('T')[0]; // Default to today
    const department = req.query.department || 'all';
    
    // Get employee database where check-ins are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('employee_checkins');

    // Get employees collection for employee details
    const { getUsersCollection } = require('../../config/mongo');
    const usersCol = await getUsersCollection(null, company || 'Ecosoul Home');

    // Build query
    const query = { date };
    if (department !== 'all') {
      // Note: Department filtering would require employee data join
      // For now, we'll return all and filter on frontend if needed
    }

    const checkIns = await col
      .find(query)
      .sort({ checkInTime: -1 })
      .toArray();

    // Get all employees to map employeeId to employee details
    const allEmployees = await usersCol.find({}).toArray();
    const employeeMap = new Map();
    allEmployees.forEach(emp => {
      const empId = emp.employeeId || emp.email?.split('@')[0] || '';
      if (empId) {
        employeeMap.set(empId, {
          name: emp.name || emp.firstName || 'Unknown',
          department: emp.department || 'General',
          biometricId: emp.biometricId || empId
        });
      }
    });

    // Transform data for frontend
    const attendanceRecords = checkIns.map(record => {
      const checkInTime = record.checkInTime ? new Date(record.checkInTime) : null;
      const checkOutTime = record.checkOutTime ? new Date(record.checkOutTime) : null;
      
      // Get employee details from map
      const employeeInfo = employeeMap.get(record.employeeId) || {
        name: record.employeeId || 'Unknown',
        department: 'General',
        biometricId: record.employeeId
      };
      
      let status = 'absent';
      let isLate = false;
      
      if (checkInTime && checkOutTime) {
        status = 'present';
        // Check if late (after 9:00 AM)
        const checkInHour = checkInTime.getHours();
        const checkInMinute = checkInTime.getMinutes();
        if (checkInHour > 9 || (checkInHour === 9 && checkInMinute > 0)) {
          isLate = true;
        }
      } else if (checkInTime && !checkOutTime) {
        status = 'present';
        const checkInHour = checkInTime.getHours();
        const checkInMinute = checkInTime.getMinutes();
        if (checkInHour > 9 || (checkInHour === 9 && checkInMinute > 0)) {
          isLate = true;
        }
      }

      const timeIn = checkInTime ? 
        `${String(checkInTime.getHours()).padStart(2, '0')}:${String(checkInTime.getMinutes()).padStart(2, '0')}` : 
        null;
      const timeOut = checkOutTime ? 
        `${String(checkOutTime.getHours()).padStart(2, '0')}:${String(checkOutTime.getMinutes()).padStart(2, '0')}` : 
        null;

      return {
        id: record._id.toString(),
        date: record.date,
        biometricId: employeeInfo.biometricId || record.employeeId,
        employeeName: employeeInfo.name,
        department: employeeInfo.department,
        status: status,
        timeIn: timeIn,
        timeOut: timeOut,
        isLate: isLate,
        totalMinutes: record.totalMinutes || 0
      };
    });

    res.json({
      success: true,
      data: {
        date,
        records: attendanceRecords
      }
    });
  } catch (error) {
    console.error('HRMS attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get attendance statistics
router.get('/attendance/stats', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const date = req.query.date || new Date().toISOString().split('T')[0];
    
    // Get employee database
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('employee_checkins');

    // Get employees collection for total count
    const { getUsersCollection } = require('../../config/mongo');
    // Try to get company name, default to 'Ecosoul Home' if not provided
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      // Try to infer from request headers or use default
      companyName = 'Ecosoul Home';
    }
    
    // Try both collections if company name is ambiguous
    let totalEmployees = 0;
    try {
      const usersCol = await getUsersCollection(null, companyName);
      totalEmployees = await usersCol.countDocuments({});
      console.log(`[attendance/stats] Total employees: ${totalEmployees} for company: ${companyName}`);
      
      // If count is 0, try the other company collection
      if (totalEmployees === 0 && (companyName === 'Ecosoul Home' || !company)) {
        const otherCompany = companyName === 'Ecosoul Home' ? 'Thrive' : 'Ecosoul Home';
        const otherUsersCol = await getUsersCollection(null, otherCompany);
        const otherCount = await otherUsersCol.countDocuments({});
        if (otherCount > 0) {
          totalEmployees = otherCount;
          companyName = otherCompany;
          console.log(`[attendance/stats] Found ${totalEmployees} employees in ${otherCompany} collection`);
        }
      }
    } catch (err) {
      console.error(`[attendance/stats] Error getting employees for ${companyName}:`, err);
      // Try default collection
      try {
        const defaultUsersCol = await getUsersCollection(null, 'Ecosoul Home');
        totalEmployees = await defaultUsersCol.countDocuments({});
        console.log(`[attendance/stats] Using default collection, found ${totalEmployees} employees`);
      } catch (defaultErr) {
        console.error('[attendance/stats] Error with default collection:', defaultErr);
      }
    }

    // Get today's check-ins
    const todayCheckIns = await col.find({ date }).toArray();

    // Calculate stats
    const presentCount = todayCheckIns.filter(c => c.checkInTime && (c.checkOutTime || !c.checkOutTime)).length;
    const absentCount = 0; // Would need total employee count to calculate
    const onLeaveCount = 0; // Would need leave data
    const onWFHCount = 0; // Would need WFH data
    const lateCheckIns = todayCheckIns.filter(c => {
      if (!c.checkInTime) return false;
      const checkIn = new Date(c.checkInTime);
      return checkIn.getHours() > 9 || (checkIn.getHours() === 9 && checkIn.getMinutes() > 0);
    }).length;

    // Get pending attendance requests count
    const requestsCol = db.collection('attendance_requests');
    const pendingRequests = await requestsCol.countDocuments({ 
      status: 'pending',
      ...(company ? { company } : {})
    });

    res.json({
      success: true,
      data: {
        totalEmployees: totalEmployees || 0,
        presentToday: presentCount,
        absentToday: absentCount,
        onLeaveToday: onLeaveCount,
        onWFHToday: onWFHCount,
        lateCheckIns,
        leaveApprovals: pendingRequests
      }
    });
  } catch (error) {
    console.error('HRMS attendance stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Example: Get leaves
router.get('/leaves', async (req, res) => {
  try {
    // TODO: Implement leaves listing
    res.json({
      success: true,
      message: 'HRMS leaves endpoint - to be implemented',
      data: []
    });
  } catch (error) {
    console.error('HRMS leaves error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get all attendance requests (for approval)
router.get('/attendance-requests', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const status = req.query.status || 'all'; // 'all', 'pending', 'approved', 'rejected'
    const type = req.query.type || 'all'; // 'all', 'regularization', 'on-duty', 'time-off'
    
    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    // Build query
    const query = {};
    if (status !== 'all') {
      query.status = status;
    }
    if (type !== 'all') {
      query.type = type;
    }
    if (company) {
      query.company = company;
    }

    const requests = await col
      .find(query)
      .sort({ submittedAt: -1 })
      .toArray();

    res.json({
      success: true,
      data: {
        requests: requests.map(req => ({
          id: req._id.toString(),
          employeeId: req.employeeId,
          type: req.type,
          status: req.status,
          submittedAt: req.submittedAt,
          date: req.date,
          timeWindow: req.timeWindow,
          notes: req.notes,
          location: req.location,
          details: req.details,
          dateRange: req.dateRange,
          reason: req.reason,
          approvedAt: req.approvedAt,
          rejectedAt: req.rejectedAt,
          approvedBy: req.approvedBy,
          rejectionReason: req.rejectionReason,
          company: req.company
        }))
      }
    });
  } catch (error) {
    console.error('HRMS attendance-requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get leave overview statistics (for leave overview page)
router.get('/leaves/overview/stats', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    
    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const requestsCol = db.collection('attendance_requests');

    const query = { type: 'time-off' };
    if (company) {
      query.company = company;
    }
    
    const allRequests = await requestsCol.find(query).toArray();
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Calculate stats
    const totalOnLeave = allRequests.filter(r => {
      if (r.status !== 'approved' || !r.dateRange) return false;
      // Parse date range to check if currently on leave
      const parts = r.dateRange.split(' - ');
      if (parts.length === 2) {
        try {
          const fromDate = new Date(parts[0].trim());
          const toDate = new Date(parts[1].trim());
          return fromDate <= now && toDate >= now;
        } catch (e) {
          return false;
        }
      }
      return false;
    }).length;

    const leaveForApproval = allRequests.filter(r => r.status === 'pending').length;
    
    const approvedThisMonth = allRequests.filter(r => {
      if (r.status !== 'approved' || !r.approvedAt) return false;
      const approvedDate = new Date(r.approvedAt);
      return approvedDate.getMonth() === currentMonth && 
             approvedDate.getFullYear() === currentYear;
    }).length;

    const rejectedThisMonth = allRequests.filter(r => {
      if (r.status !== 'rejected' || !r.rejectedAt) return false;
      const rejectedDate = new Date(r.rejectedAt);
      return rejectedDate.getMonth() === currentMonth && 
             rejectedDate.getFullYear() === currentYear;
    }).length;

    res.json({
      success: true,
      data: {
        totalOnLeave,
        leaveForApproval,
        approvedThisMonth,
        rejectedThisMonth
      }
    });
  } catch (error) {
    console.error('HRMS leaves/overview/stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get yearly leave utilization data
router.get('/leaves/overview/utilization', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const year = req.query.year || new Date().getFullYear();
    
    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const requestsCol = db.collection('attendance_requests');

    const query = { 
      type: 'time-off',
      status: 'approved'
    };
    if (company) {
      query.company = company;
    }
    
    const approvedRequests = await requestsCol.find(query).toArray();
    
    // Get employees list for employee names
    const { getUsersCollection } = require('../../config/mongo');
    let companyName = company || 'Ecosoul Home';
    const usersCol = await getUsersCollection(null, companyName);
    const employees = await usersCol.find({}).toArray();
    const employeeMap = new Map();
    employees.forEach(emp => {
      const empId = emp.employeeId || emp.email?.split('@')[0] || '';
      if (empId) {
        employeeMap.set(empId, {
          name: emp.name || emp.firstName || 'Unknown',
          employeeId: empId
        });
      }
    });
    
    // Calculate leave utilization per employee
    const utilizationMap = new Map();
    
    approvedRequests.forEach(req => {
      if (!req.dateRange || !req.employeeId) return;
      
      const parts = req.dateRange.split(' - ');
      if (parts.length !== 2) return;
      
      try {
        const fromDate = new Date(parts[0].trim());
        const toDate = new Date(parts[1].trim());
        
        // Check if request is in the current year
        if (fromDate.getFullYear() === year || toDate.getFullYear() === year) {
          const diffTime = Math.abs(toDate - fromDate);
          const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          
          if (!utilizationMap.has(req.employeeId)) {
            utilizationMap.set(req.employeeId, {
              employeeId: req.employeeId,
              utilized: 0,
              remaining: 12 // Default leave balance, can be configured
            });
          }
          
          const util = utilizationMap.get(req.employeeId);
          util.utilized += days;
        }
      } catch (e) {
        // Skip invalid dates
      }
    });
    
    // Convert to array format for chart
    const utilizationData = Array.from(utilizationMap.values())
      .map(util => {
        const empInfo = employeeMap.get(util.employeeId) || { name: util.employeeId };
        return {
          employee: empInfo.name,
          utilized: util.utilized,
          remaining: Math.max(0, util.remaining - util.utilized)
        };
      })
      .sort((a, b) => b.utilized - a.utilized)
      .slice(0, 15); // Top 15 employees
    
    res.json({
      success: true,
      data: {
        utilization: utilizationData,
        year
      }
    });
  } catch (error) {
    console.error('HRMS leaves/overview/utilization error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get attendance request statistics
router.get('/attendance-requests/stats', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    
    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const query = company ? { company } : {};
    
    const total = await col.countDocuments(query);
    const pending = await col.countDocuments({ ...query, status: 'pending' });
    const approved = await col.countDocuments({ ...query, status: 'approved' });
    const rejected = await col.countDocuments({ ...query, status: 'rejected' });

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const approvedToday = await col.countDocuments({
      ...query,
      status: 'approved',
      approvedAt: { $gte: today }
    });
    const rejectedToday = await col.countDocuments({
      ...query,
      status: 'rejected',
      rejectedAt: { $gte: today }
    });

    res.json({
      success: true,
      data: {
        total,
        pending,
        approved,
        rejected,
        approvedToday,
        rejectedToday
      }
    });
  } catch (error) {
    console.error('HRMS attendance-requests/stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Approve attendance request
router.post('/attendance-requests/:requestId/approve', async (req, res) => {
  try {
    await connectMongo();
    const { requestId } = req.params;
    const { approvedBy } = req.body;
    const company = getCompanyFromRequest(req);
    
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    const request = await col.findOne({ _id: new ObjectId(requestId) });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request is not pending' });
    }

    await col.updateOne(
      { _id: new ObjectId(requestId) },
      {
        $set: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: approvedBy || 'Admin',
          updatedAt: new Date()
        }
      }
    );

    console.log(`[hrms-portal] Attendance request ${requestId} approved by ${approvedBy || 'Admin'}`);

    res.json({
      success: true,
      message: 'Request approved successfully',
      data: {
        requestId,
        status: 'approved'
      }
    });
  } catch (error) {
    console.error('HRMS approve attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Reject attendance request
router.post('/attendance-requests/:requestId/reject', async (req, res) => {
  try {
    await connectMongo();
    const { requestId } = req.params;
    const { rejectedBy, rejectionReason } = req.body;
    const company = getCompanyFromRequest(req);
    
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    const request = await col.findOne({ _id: new ObjectId(requestId) });

    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request is not pending' });
    }

    await col.updateOne(
      { _id: new ObjectId(requestId) },
      {
        $set: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectedBy: rejectedBy || 'Admin',
          rejectionReason: rejectionReason || '',
          updatedAt: new Date()
        }
      }
    );

    console.log(`[hrms-portal] Attendance request ${requestId} rejected by ${rejectedBy || 'Admin'}`);

    res.json({
      success: true,
      message: 'Request rejected successfully',
      data: {
        requestId,
        status: 'rejected'
      }
    });
  } catch (error) {
    console.error('HRMS reject attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get leave policy
router.get('/leave-policy', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    
    // Get HRMS database
    const db = await getHrmsDb(company);
    const col = db.collection('leave_policies');
    
    // Try to get company-specific policy
    let policy = await col.findOne({ company: company || null });
    
    // If no company-specific policy, return default
    if (!policy) {
      policy = {
        company: company || null,
        '0-6months': {
          casualLeave: 0,
          sickLeave: 3,
          earnedLeave: 0,
          compOff: 0
        },
        '6-12months': {
          casualLeave: 6,
          sickLeave: 6,
          earnedLeave: 0,
          compOff: 0
        },
        '1year+': {
          casualLeave: 12,
          sickLeave: 6,
          earnedLeave: 10,
          compOff: 0
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
    
    res.json({
      success: true,
      data: {
        '0-6months': policy['0-6months'] || policy['0-6 Months'] || {
          casualLeave: 0,
          sickLeave: 3,
          earnedLeave: 0,
          compOff: 0
        },
        '6-12months': policy['6-12months'] || policy['6-12 Months'] || {
          casualLeave: 6,
          sickLeave: 6,
          earnedLeave: 0,
          compOff: 0
        },
        '1year+': policy['1year+'] || policy['1 Year+'] || {
          casualLeave: 12,
          sickLeave: 6,
          earnedLeave: 10,
          compOff: 0
        }
      }
    });
  } catch (error) {
    console.error('HRMS leave-policy GET error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Update leave policy
router.put('/leave-policy', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { '0-6months': months0_6, '6-12months': months6_12, '1year+': year1Plus } = req.body;
    
    if (!months0_6 || !months6_12 || !year1Plus) {
      return res.status(400).json({
        success: false,
        error: 'All tenure policies are required'
      });
    }
    
    // Get HRMS database
    const db = await getHrmsDb(company);
    const col = db.collection('leave_policies');
    
    const policy = {
      company: company || null,
      '0-6months': months0_6,
      '6-12months': months6_12,
      '1year+': year1Plus,
      updatedAt: new Date()
    };
    
    // Upsert policy
    await col.updateOne(
      { company: company || null },
      { 
        $set: policy,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    
    res.json({
      success: true,
      message: 'Leave policy updated successfully',
      data: policy
    });
  } catch (error) {
    console.error('HRMS leave-policy PUT error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;


