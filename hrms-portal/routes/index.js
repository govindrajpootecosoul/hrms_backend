const express = require('express');
const router = express.Router();
const { connectMongo, getDb, getEmployeePortalDb } = require('../../config/mongo');
const { getCompanyDatabaseName } = require('../../config/database.config');

/**
 * Get company from request (query parameter, route param, or header)
 * Supports:
 * - ?company=Thrive
 * - ?companyId=2 (normalized later to 'Thrive')
 * - x-company header
 */
function getCompanyFromRequest(req) {
  return (
    req.query.company ||
    req.query.companyId ||
    req.headers['x-company'] ||
    null
  );
}

/**
 * Normalize company value to canonical name ('Ecosoul Home' or 'Thrive').
 * Returns null if missing or invalid (multi-tenant: never return other company's data).
 */
function normalizeCompany(value) {
  if (value == null || value === '' || value === 'undefined') return null;
  const raw = String(value).trim();
  if (!raw || raw === 'all') return null;
  const lc = raw.toLowerCase();
  if (lc === '1' || lc === 'ecosoul' || lc === 'ecosoulhome' || lc === 'eco soul' || lc === 'ecosoul home') return 'Ecosoul Home';
  if (lc === '2' || lc === 'thrive' || lc === 'thrive brands' || lc === 'thrivebrands') return 'Thrive';
  return raw;
}

/**
 * Require company for company-scoped routes. Sends 400 if missing.
 * @returns {string|null} Normalized company name or null (response already sent)
 */
function requireCompany(req, res) {
  const company = normalizeCompany(getCompanyFromRequest(req));
  if (!company) {
    res.status(400).json({ success: false, error: 'Company is required. Please ensure your company is selected.' });
    return null;
  }
  return company;
}

/** Fixed recruiter names for "All Recruiters" dropdown in recruitment */
const RECRUITMENT_RECRUITER_NAMES = ['Priyanka', 'Charu', 'Megha', 'Harshita', 'Deepali'];

/**
 * Get HRMS database (company-specific or all data for admin)
 * For HRMS Admin Portal, if company is null or 'all', return default database with all data
 */
async function getHrmsDb(company = null) {
  await connectMongo();
  // For HRMS Admin Portal - show all data if company is null or 'all'
  if (!company || company === 'all' || company === 'undefined') {
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
 * Get all HRMS databases for aggregating data across companies
 * Optimized for fast loading - uses parallel queries
 */
async function getAllHrmsDbs() {
  await connectMongo();
  const { getDatabaseName } = require('../../config/database.config');
  
  // Get default HRMS database
  const defaultDb = await getDb(getDatabaseName('hrms'));
  
  // Try to get company-specific databases in parallel for faster loading
  const companyNames = ['Ecosoul Home', 'Thrive'];
  const dbPromises = companyNames.map(async (companyName) => {
    try {
      const dbName = getCompanyDatabaseName('hrms', companyName);
      const { MongoClient } = require('mongodb');
      const { getMongoUri } = require('../../config/app.config');
      const uri = getMongoUri();
      const client = new MongoClient(uri);
      await client.connect();
      const db = client.db(dbName);
      
      // Quick check if database has data
      const recruitmentCol = db.collection('recruitment');
      const count = await recruitmentCol.countDocuments({}, { limit: 1 });
      if (count > 0) {
        return db;
      }
      await client.close();
      return null;
    } catch (err) {
      // Database doesn't exist or error, skip
      return null;
    }
  });
  
  const companyDbs = await Promise.all(dbPromises);
  const dbs = [defaultDb, ...companyDbs.filter(db => db !== null)];
  
  return dbs;
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

// Get all employees (company-scoped: only return employees for the requested company)
router.get('/employees', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { search, department, status } = req.query;
    
    const { getUsersCollection } = require('../../config/mongo');
    let usersCol;
    try {
      usersCol = await getUsersCollection(null, company);
    } catch (err) {
      console.error(`[employees] Error getting employees for ${company}:`, err);
      return res.status(500).json({ success: false, error: 'Failed to load employees for this company.' });
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

// Get all employees attendance data (company-scoped)
router.get('/attendance', async (req, res) => {
  try {
    const companyName = requireCompany(req, res);
    if (!companyName) return;
    await connectMongo();
    
    const date = req.query.date || new Date().toISOString().split('T')[0]; // Default to today
    const department = req.query.department || 'all';
    
    // Get employee database where check-ins are stored (use normalized company)
    const db = await getEmployeeDbForHrms(companyName);
    let col = db.collection('employee_checkins');

    // Get employees collection for employee details
    const { getUsersCollection } = require('../../config/mongo');
    const usersCol = await getUsersCollection(null, companyName);

    // Build query - try date field first
    let query = { date };
    if (department !== 'all') {
      // Note: Department filtering would require employee data join
      // For now, we'll return all and filter on frontend if needed
    }

    let checkIns = await col
      .find(query)
      .sort({ checkInTime: -1 })
      .toArray();
    
    console.log(`[attendance] Found ${checkIns.length} check-ins for date: ${date} (company DB: ${companyName})`);
    
    // If no results, try querying by checkInTime date range
    if (checkIns.length === 0) {
      try {
        const todayDate = new Date(date);
        const startOfDay = new Date(todayDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(todayDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        console.log(`[attendance] Trying alternative query by checkInTime range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
        const alternativeQuery = {
          checkInTime: {
            $gte: startOfDay,
            $lte: endOfDay
          }
        };
        checkIns = await col.find(alternativeQuery).sort({ checkInTime: -1 }).toArray();
        console.log(`[attendance] Found ${checkIns.length} check-ins using checkInTime range query (company DB)`);
      } catch (e) {
        console.error('[attendance] Alternative query by checkInTime failed:', e);
      }
    }
    
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

// Get attendance statistics (company-scoped)
router.get('/attendance/stats', async (req, res) => {
  try {
    const effectiveCompany = requireCompany(req, res);
    if (!effectiveCompany) return;
    await connectMongo();
    const date = req.query.date || new Date().toISOString().split('T')[0];
    
    const db = await getEmployeeDbForHrms(effectiveCompany);
    let col = db.collection('employee_checkins');

    const { getUsersCollection } = require('../../config/mongo');
    const companyName = effectiveCompany;
    let totalEmployees = 0;
    let employeesList = [];
    try {
      const usersCol = await getUsersCollection(null, companyName);
      employeesList = await usersCol.find({}).toArray();
      totalEmployees = employeesList.length;
      console.log(`[attendance/stats] Total employees: ${totalEmployees} for company: ${companyName}`);
    } catch (err) {
      console.error(`[attendance/stats] Error getting employees for ${companyName}:`, err);
      return res.status(500).json({ success: false, error: 'Failed to load attendance stats for this company.' });
    }

    // Debug: Check total records in collection and sample records
    const totalCheckIns = await col.countDocuments({});
    const sampleCheckIns = await col.find({}).limit(5).toArray();
    console.log(`[attendance/stats] Total check-ins in collection: ${totalCheckIns}`);
    if (sampleCheckIns.length > 0) {
      console.log(`[attendance/stats] Sample check-in record:`, JSON.stringify(sampleCheckIns[0], null, 2));
    }
    
    // Build employeeId mapping - map all possible employeeId formats to a canonical form
    const employeeIdMap = new Map(); // Maps any employeeId format to canonical employeeId
    employeesList.forEach(emp => {
      const canonicalId = emp.employeeId || emp.email?.split('@')[0] || '';
      if (canonicalId) {
        // Map the canonical ID to itself
        employeeIdMap.set(canonicalId, canonicalId);
        // Also map email prefix if different
        if (emp.email) {
          const emailPrefix = emp.email.split('@')[0];
          if (emailPrefix !== canonicalId) {
            employeeIdMap.set(emailPrefix, canonicalId);
          }
        }
        // Map employeeId if it exists and is different
        if (emp.employeeId && emp.employeeId !== canonicalId) {
          employeeIdMap.set(emp.employeeId, canonicalId);
        }
        // Also map full email if it's used as employeeId
        if (emp.email) {
          employeeIdMap.set(emp.email, canonicalId);
        }
      }
    });
    
    console.log(`[attendance/stats] Built employeeId map with ${employeeIdMap.size} entries`);
    
    // Get today's check-ins - filter by date
    // Date format should be YYYY-MM-DD (e.g., "2025-02-16")
    // First, let's check what check-ins exist in the database (recent ones for debugging)
    const recentCheckIns = await col.find({}).sort({ checkInTime: -1 }).limit(5).toArray();
    if (recentCheckIns.length > 0) {
      console.log(`[attendance/stats] Sample recent check-ins structure:`, JSON.stringify(recentCheckIns.map(c => ({
        date: c.date,
        checkInTime: c.checkInTime,
        employeeId: c.employeeId,
        dateType: typeof c.date
      })), null, 2));
    } else {
      console.log(`[attendance/stats] No check-ins found in company DB collection at all`);
    }
    
    // Try querying by date field first
    let checkInQuery = { date };
    console.log(`[attendance/stats] Querying check-ins with date: ${date}, company: ${companyName}`);
    
    let todayCheckIns = await col.find(checkInQuery).toArray();
    console.log(`[attendance/stats] Found ${todayCheckIns.length} check-in records for date: ${date} (company DB)`);
    
    // If no results, try querying by checkInTime date range
    if (todayCheckIns.length === 0) {
      try {
        const todayDate = new Date(date);
        const startOfDay = new Date(todayDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(todayDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        console.log(`[attendance/stats] Trying alternative query by checkInTime range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
        const alternativeQuery = {
          checkInTime: {
            $gte: startOfDay,
            $lte: endOfDay
          }
        };
        todayCheckIns = await col.find(alternativeQuery).toArray();
        console.log(`[attendance/stats] Found ${todayCheckIns.length} check-in records using checkInTime range query (company DB)`);
      } catch (e) {
        console.error('[attendance/stats] Alternative query by checkInTime failed:', e);
      }
    }
    
    if (todayCheckIns.length > 0) {
      console.log(`[attendance/stats] Sample today's check-in:`, JSON.stringify(todayCheckIns[0], null, 2));
    } else {
      console.log(`[attendance/stats] WARNING: No check-ins found for date ${date} in any database`);
    }

    // Get approved leave requests for today
    const requestsCol = db.collection('attendance_requests');
    const todayDateStr = date; // Format: YYYY-MM-DD
    
    // Get approved time-off requests that overlap with today
    const approvedLeaveQuery = {
      type: 'time-off',
      status: 'approved',
      ...(companyName ? { company: companyName } : {})
    };
    const approvedLeaves = await requestsCol.find(approvedLeaveQuery).toArray();
    
    const onLeaveEmployees = new Set();
    approvedLeaves.forEach(leave => {
      if (leave.dateRange) {
        const parts = leave.dateRange.split(' - ');
        if (parts.length === 2) {
          try {
            // Parse dates - handle both "YYYY-MM-DD" and "DD MMM YYYY" formats
            let fromDateStr = parts[0].trim();
            let toDateStr = parts[1].trim();
            
            // Convert to Date objects and normalize to YYYY-MM-DD format
            const fromDate = new Date(fromDateStr);
            const toDate = new Date(toDateStr);
            const todayDate = new Date(todayDateStr);
            
            // Normalize all dates to start of day for comparison
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(0, 0, 0, 0);
            todayDate.setHours(0, 0, 0, 0);
            
            // Check if today falls within the leave date range
            if (todayDate >= fromDate && todayDate <= toDate) {
              // Normalize employeeId for leave
              const leaveEmpId = leave.employeeId;
              let normalizedLeaveId = employeeIdMap.get(leaveEmpId);
              if (!normalizedLeaveId) {
                const matchingEmp = employeesList.find(emp => {
                  const empId = emp.employeeId || emp.email?.split('@')[0] || '';
                  const emailPrefix = emp.email?.split('@')[0] || '';
                  return empId === leaveEmpId || 
                         emailPrefix === leaveEmpId ||
                         emp.email === leaveEmpId ||
                         emp.employeeId === leaveEmpId;
                });
                if (matchingEmp) {
                  normalizedLeaveId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || leaveEmpId;
                  employeeIdMap.set(leaveEmpId, normalizedLeaveId);
                } else {
                  normalizedLeaveId = leaveEmpId;
                }
              }
              onLeaveEmployees.add(normalizedLeaveId);
            }
          } catch (e) {
            console.error('[attendance/stats] Error parsing leave date range:', leave.dateRange, e);
          }
        }
      }
    });
    const onLeaveCount = onLeaveEmployees.size;

    // Count WFH - employees who checked in but marked as WFH or have WFH status
    // Also check for WFH requests in attendance_requests
    const wfhEmployees = new Set();
    
    // First, check check-ins for WFH status
    todayCheckIns.forEach(c => {
      if (c.checkInTime && c.employeeId) {
        // Check if marked as WFH in check-in record
        const isWFH = c.status === 'wfh' || 
                      c.status === 'WFH' ||
                      c.location === 'remote' || 
                      c.location === 'WFH' ||
                      c.location === 'wfh' ||
                      c.workMode === 'WFH' ||
                      c.workMode === 'wfh';
        
        if (isWFH) {
          // Try to normalize the employeeId using our map
          let normalizedId = employeeIdMap.get(c.employeeId);
          
          // If not found in map, try to find by matching with employee list
          if (!normalizedId) {
            const matchingEmp = employeesList.find(emp => {
              const empId = emp.employeeId || emp.email?.split('@')[0] || '';
              const emailPrefix = emp.email?.split('@')[0] || '';
              return empId === c.employeeId || 
                     emailPrefix === c.employeeId ||
                     emp.email === c.employeeId ||
                     emp.employeeId === c.employeeId;
            });
            
            if (matchingEmp) {
              normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || c.employeeId;
              employeeIdMap.set(c.employeeId, normalizedId);
            } else {
              normalizedId = c.employeeId;
            }
          }
          
          wfhEmployees.add(normalizedId);
          console.log(`[attendance/stats] Found WFH check-in for employee: ${c.employeeId} (normalized: ${normalizedId})`);
        }
      }
    });
    
    // Also check for approved WFH requests
    const wfhRequestsQuery = {
      type: { $in: ['wfh', 'WFH', 'work-from-home', 'work from home'] },
      status: 'approved',
      ...(companyName ? { company: companyName } : {})
    };
    const wfhRequests = await requestsCol.find(wfhRequestsQuery).toArray();
    wfhRequests.forEach(req => {
      if (req.dateRange) {
        const parts = req.dateRange.split(' - ');
        if (parts.length === 2) {
          try {
            const fromDate = new Date(parts[0].trim());
            const toDate = new Date(parts[1].trim());
            const todayDate = new Date(todayDateStr);
            
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(0, 0, 0, 0);
            todayDate.setHours(0, 0, 0, 0);
            
            if (todayDate >= fromDate && todayDate <= toDate) {
              const reqEmpId = req.employeeId;
              let normalizedId = employeeIdMap.get(reqEmpId);
              if (!normalizedId) {
                const matchingEmp = employeesList.find(emp => {
                  const empId = emp.employeeId || emp.email?.split('@')[0] || '';
                  return empId === reqEmpId || emp.email === reqEmpId || emp.employeeId === reqEmpId;
                });
                if (matchingEmp) {
                  normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || reqEmpId;
                  employeeIdMap.set(reqEmpId, normalizedId);
                } else {
                  normalizedId = reqEmpId;
                }
              }
              wfhEmployees.add(normalizedId);
              console.log(`[attendance/stats] Found WFH request for employee: ${reqEmpId} (normalized: ${normalizedId})`);
            }
          } catch (e) {
            console.error('[attendance/stats] Error parsing WFH request date range:', req.dateRange, e);
          }
        }
      }
    });
    
    const onWFHCount = wfhEmployees.size;
    console.log(`[attendance/stats] WFH employees: ${onWFHCount}`, Array.from(wfhEmployees));

    // Get unique employees who checked in today (have checkInTime) - EXCLUDING WFH
    // Present = employees who checked in AND are NOT WFH
    const presentEmployees = new Set();
    todayCheckIns.forEach(c => {
      if (c.checkInTime && c.employeeId) {
        // Skip if this employee is WFH
        const isWFH = c.status === 'wfh' || 
                      c.status === 'WFH' ||
                      c.location === 'remote' || 
                      c.location === 'WFH' ||
                      c.location === 'wfh' ||
                      c.workMode === 'WFH' ||
                      c.workMode === 'wfh';
        
        if (!isWFH) {
          // Try to normalize the employeeId using our map
          let normalizedId = employeeIdMap.get(c.employeeId);
          
          // If not found in map, try to find by matching with employee list
          if (!normalizedId) {
            const matchingEmp = employeesList.find(emp => {
              const empId = emp.employeeId || emp.email?.split('@')[0] || '';
              const emailPrefix = emp.email?.split('@')[0] || '';
              return empId === c.employeeId || 
                     emailPrefix === c.employeeId ||
                     emp.email === c.employeeId ||
                     emp.employeeId === c.employeeId;
            });
            
            if (matchingEmp) {
              normalizedId = matchingEmp.employeeId || matchingEmp.email?.split('@')[0] || c.employeeId;
              employeeIdMap.set(c.employeeId, normalizedId);
            } else {
              normalizedId = c.employeeId;
            }
          }
          
          // Only add if not WFH and not on leave
          if (!wfhEmployees.has(normalizedId) && !onLeaveEmployees.has(normalizedId)) {
            presentEmployees.add(normalizedId);
            console.log(`[attendance/stats] Found present check-in for employee: ${c.employeeId} (normalized: ${normalizedId}), checkInTime: ${c.checkInTime}`);
          }
        }
      }
    });
    const presentCount = presentEmployees.size;
    
    console.log(`[attendance/stats] Present employees (excluding WFH and Leave): ${presentCount}`, Array.from(presentEmployees));

    // Calculate absent count: Total employees - Present - On Leave - WFH
    const absentCount = Math.max(0, totalEmployees - presentCount - onLeaveCount - onWFHCount);

    // Count late check-ins (check-in after 9:00 AM)
    const lateCheckIns = todayCheckIns.filter(c => {
      if (!c.checkInTime) return false;
      const checkIn = new Date(c.checkInTime);
      return checkIn.getHours() > 9 || (checkIn.getHours() === 9 && checkIn.getMinutes() > 0);
    }).length;

    // Get pending attendance requests count
    const pendingRequests = await requestsCol.countDocuments({ 
      status: 'pending',
      ...(companyName ? { company: companyName } : {})
    });
    
    console.log(`[attendance/stats] Stats for ${date}:`, {
      totalEmployees,
      presentCount,
      absentCount,
      onLeaveCount,
      onWFHCount,
      lateCheckIns,
      pendingRequests
    });

    // Set no-cache headers to prevent caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Timestamp', Date.now().toString());
    
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

// Get all attendance requests (for approval) - company-scoped
router.get('/attendance-requests', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const status = req.query.status || 'all'; // 'all', 'pending', 'approved', 'rejected'
    const type = req.query.type || 'all'; // 'all', 'regularization', 'on-duty', 'time-off'
    
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
          leaveType: req.leaveType || null, // Include leave type if available
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

// Get leave overview statistics (for leave overview page) - company-scoped
router.get('/leaves/overview/stats', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
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

// Get yearly leave utilization data - company-scoped
router.get('/leaves/overview/utilization', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const year = req.query.year || new Date().getFullYear();
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

// Get attendance request statistics - company-scoped
router.get('/attendance-requests/stats', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
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

// Approve attendance request - company-scoped
router.post('/attendance-requests/:requestId/approve', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;
    const { approvedBy } = req.body;
    
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    console.log(`[hrms-portal] Approving request ${requestId} for company: ${company || 'default'}`);

    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    
    // Try multiple query formats to find the request
    let request = null;
    let updateQuery = null;
    
    // Try 1: ObjectId format (most common)
    try {
      if (ObjectId.isValid(requestId)) {
        const objectIdQuery = { _id: new ObjectId(requestId) };
        request = await col.findOne(objectIdQuery);
        if (request) {
          updateQuery = { _id: new ObjectId(requestId) };
          console.log(`[hrms-portal] Found request using ObjectId format`);
        }
      }
    } catch (e) {
      console.log(`[hrms-portal] ObjectId conversion failed for ${requestId}:`, e.message);
    }
    
    // Try 2: String _id format
    if (!request) {
      const stringIdQuery = { _id: requestId };
      request = await col.findOne(stringIdQuery);
      if (request) {
        updateQuery = { _id: requestId };
        console.log(`[hrms-portal] Found request using string _id format`);
      }
    }
    
    // Try 3: id field format (if requests have an id field separate from _id)
    if (!request) {
      const idFieldQuery = { id: requestId };
      request = await col.findOne(idFieldQuery);
      if (request) {
        updateQuery = { id: requestId };
        console.log(`[hrms-portal] Found request using id field format`);
      }
    }

    // Try 4: Check all documents and find by matching string representation of _id
    if (!request) {
      console.log(`[hrms-portal] Trying to find request by scanning collection...`);
      const allRequests = await col.find({}).toArray();
      console.log(`[hrms-portal] Found ${allRequests.length} total requests in collection`);
      
      for (const req of allRequests) {
        const reqIdStr = req._id ? req._id.toString() : '';
        if (reqIdStr === requestId || req.id === requestId) {
          request = req;
          updateQuery = { _id: req._id };
          console.log(`[hrms-portal] Found request by scanning: ${reqIdStr}`);
          break;
        }
      }
    }

    if (!request) {
      console.error(`[hrms-portal] Request not found with ID: ${requestId} in company: ${company || 'default'}`);
      console.error(`[hrms-portal] Available request IDs in collection (first 5):`);
      try {
        const sampleRequests = await col.find({}).limit(5).toArray();
        sampleRequests.forEach((req, idx) => {
          console.error(`  ${idx + 1}. _id: ${req._id}, id: ${req.id || 'N/A'}, employeeId: ${req.employeeId || 'N/A'}`);
        });
      } catch (e) {
        console.error(`[hrms-portal] Could not fetch sample requests:`, e.message);
      }
      
      return res.status(404).json({ 
        success: false, 
        error: `Request not found with ID: ${requestId}. Please refresh the page and try again.` 
      });
    }

    // Check if request is already processed
    if (request.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Request is already ${request.status}. Cannot approve again.` 
      });
    }

    // Perform the update
    const updateResult = await col.updateOne(
      updateQuery,
      {
        $set: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: approvedBy || 'Admin',
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      console.error(`[hrms-portal] Update failed - no document matched for ID: ${requestId}`);
      console.error(`[hrms-portal] Update query used:`, JSON.stringify(updateQuery));
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found or could not be updated' 
      });
    }

    if (updateResult.modifiedCount === 0) {
      console.warn(`[hrms-portal] Update matched but did not modify - request may already be approved`);
    }

    console.log(`[hrms-portal] ✅ Attendance request ${requestId} approved by ${approvedBy || 'Admin'}`);

    res.json({
      success: true,
      message: 'Request approved successfully',
      data: {
        requestId,
        status: 'approved'
      }
    });
  } catch (error) {
    console.error('[hrms-portal] ❌ Approve attendance-request error:', error);
    console.error('[hrms-portal] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error. Please try again or contact support.'
    });
  }
});

// Reject attendance request - company-scoped
router.post('/attendance-requests/:requestId/reject', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;
    const { rejectedBy, rejectionReason } = req.body;
    
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    // Get employee database where attendance requests are stored
    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }
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

// Update attendance request (edit) - company-scoped
router.put('/attendance-requests/:requestId', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    const existing = await col.findOne({ _id: new ObjectId(requestId) });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Safety: only allow editing pending requests (can be relaxed later if needed)
    if (existing.status && existing.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending requests can be edited' });
    }

    const { leaveType, reason, from, to, dateRange } = req.body || {};

    // Build update fields (only allow known fields)
    const update = { updatedAt: new Date() };

    if (typeof leaveType === 'string') update.leaveType = leaveType;
    if (typeof reason === 'string') update.reason = reason;

    let normalizedFrom = typeof from === 'string' ? from.trim() : '';
    let normalizedTo = typeof to === 'string' ? to.trim() : '';

    const parseDate = (s) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const fromDate = normalizedFrom ? parseDate(normalizedFrom) : null;
    const toDate = normalizedTo ? parseDate(normalizedTo) : null;

    if ((normalizedFrom && !fromDate) || (normalizedTo && !toDate)) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date' });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ success: false, error: 'From date cannot be after To date' });
    }

    // Store from/to if provided
    if (fromDate) update.from = fromDate.toISOString().split('T')[0];
    if (toDate) update.to = toDate.toISOString().split('T')[0];

    // Prefer dateRange if explicitly provided; otherwise build it from from/to if both exist
    if (typeof dateRange === 'string' && dateRange.trim()) {
      update.dateRange = dateRange.trim();
    } else if (fromDate && toDate) {
      update.dateRange = `${update.from} - ${update.to}`;
    }

    await col.updateOne({ _id: new ObjectId(requestId) }, { $set: update });

    res.json({
      success: true,
      message: 'Request updated successfully',
      data: { requestId },
    });
  } catch (error) {
    console.error('HRMS update attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// Delete attendance request - company-scoped
router.delete('/attendance-requests/:requestId', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({ success: false, error: 'Request ID is required' });
    }

    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(requestId)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID' });
    }

    const existing = await col.findOne({ _id: new ObjectId(requestId) });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Safety: only allow deleting pending requests (can be relaxed later if needed)
    if (existing.status && existing.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Only pending requests can be deleted' });
    }

    await col.deleteOne({ _id: new ObjectId(requestId) });

    res.json({
      success: true,
      message: 'Request deleted successfully',
      data: { requestId },
    });
  } catch (error) {
    console.error('HRMS delete attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// Create attendance request (admin - Add Leave Request) - company-scoped
router.post('/attendance-requests', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const {
      employeeId,
      leaveType,
      from,
      to,
      reason,
      type,
      notes,
      details,
      location,
    } = req.body || {};

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, error: 'employeeId is required' });
    }
    if (!leaveType || typeof leaveType !== 'string') {
      return res.status(400).json({ success: false, error: 'leaveType is required' });
    }
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'from and to are required' });
    }

    const parseDate = (s) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date' });
    }
    if (fromDate > toDate) {
      return res.status(400).json({ success: false, error: 'From date cannot be after To date' });
    }

    const normalizedFrom = fromDate.toISOString().split('T')[0];
    const normalizedTo = toDate.toISOString().split('T')[0];

    const db = await getEmployeeDbForHrms(company);
    const col = db.collection('attendance_requests');

    const doc = {
      employeeId: employeeId.trim(),
      type: typeof type === 'string' && type.trim() ? type.trim() : 'time-off',
      status: 'pending',
      submittedAt: new Date(),
      updatedAt: new Date(),
      company: company || null,
      leaveType: leaveType.trim(),
      from: normalizedFrom,
      to: normalizedTo,
      dateRange: `${normalizedFrom} - ${normalizedTo}`,
      reason: typeof reason === 'string' ? reason : '',
      notes: typeof notes === 'string' ? notes : undefined,
      details: typeof details === 'string' ? details : undefined,
      location: typeof location === 'string' ? location : undefined,
    };

    // remove undefined fields
    Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);

    const result = await col.insertOne(doc);

    res.json({
      success: true,
      message: 'Request created successfully',
      data: {
        requestId: result.insertedId?.toString?.() || result.insertedId,
      },
    });
  } catch (error) {
    console.error('HRMS create attendance-request error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// Get leave policy - company-scoped
router.get('/leave-policy', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
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

// Update leave policy - company-scoped
router.put('/leave-policy', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
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

// Get recruitment analytics - company-scoped
router.get('/recruitment/analytics', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { month, hr, department } = req.query;
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    // Build query filters
    const query = {};
    if (hr && hr !== 'All HRs') {
      query.assignedTo = hr;
    }
    if (department && department !== 'All Departments') {
      query.department = department;
    }
    
    // Get all recruitment records
    const allRecords = await recruitmentCol.find(query).toArray();
    
    // Calculate date range based on month filter
    const now = new Date();
    let startDate, endDate;
    
    switch (month) {
      case 'Last Month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'Last 3 Months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'Last 6 Months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'This Year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      default: // This Month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    
    // Filter records by date if assignDate exists
    const filteredRecords = allRecords.filter(record => {
      if (!record.assignDate) return true;
      const recordDate = new Date(record.assignDate);
      return recordDate >= startDate && recordDate <= endDate;
    });
    
    // Calculate KPIs
    const totalActiveJobs = new Set(filteredRecords.map(r => r.position || r.jobTitle).filter(Boolean)).size;
    const totalApplications = filteredRecords.length;
    const shortlisted = filteredRecords.filter(r => r.status === 'Shortlisted' || r.status === 'shortlisted').length;
    const interviewsScheduled = filteredRecords.filter(r => r.status === 'Interview Scheduled' || r.status === 'Interview Aligned' || r.status === 'interview_scheduled').length;
    const offersSent = filteredRecords.filter(r => r.status === 'Offer Sent' || r.status === 'Finalized' || r.status === 'offer_sent').length;
    const hired = filteredRecords.filter(r => r.status === 'Hired' || r.hiringStatus === 'Hired' || r.status === 'hired').length;
    
    // Calculate averages (simplified - would need more data for accurate calculations)
    const avgTimeToHire = hired > 0 ? (totalApplications / hired).toFixed(1) + '%' : '0%';
    const avgInterviewTime = interviewsScheduled > 0 ? Math.round(totalApplications / interviewsScheduled) + ' Days' : '0 Days';
    const avgOfferAcceptanceRate = offersSent > 0 ? Math.round((hired / offersSent) * 100) + '%' : '0%';
    const offerRejectionRate = offersSent > 0 ? ((offersSent - hired) / offersSent * 100).toFixed(1) + '%' : '0%';
    
    // Get HR list for filters
    const { getUsersCollection } = require('../../config/mongo');
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    let hrList = [];
    try {
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      hrList = employees.map(emp => emp.name || emp.firstName || 'Unknown').filter(Boolean);
    } catch (err) {
      console.error('Error fetching HR list:', err);
    }
    
    // Candidate for Interview in Pipeline by HR
    const pipelineByHR = {};
    filteredRecords.forEach(record => {
      if (record.status === 'Interview Scheduled' || record.status === 'Interview Aligned' || record.status === 'interview_scheduled') {
        const hrName = record.assignedTo || 'Unknown';
        if (!pipelineByHR[hrName]) {
          pipelineByHR[hrName] = 0;
        }
        pipelineByHR[hrName]++;
      }
    });
    
    const pipelineByHRArray = Object.entries(pipelineByHR).map(([name, candidates]) => ({
      name,
      candidates,
      percentage: totalApplications > 0 ? ((candidates / totalApplications) * 100).toFixed(1) : 0
    }));
    
    // Recruitment Funnel (status distribution)
    const statusCounts = {};
    filteredRecords.forEach(record => {
      const status = record.status || 'New';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    const recruitmentFunnel = [
      { stage: 'New', candidates: statusCounts['New'] || 0, percentage: totalApplications > 0 ? (((statusCounts['New'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Shortlisted', candidates: statusCounts['Shortlisted'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Shortlisted'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Screening', candidates: statusCounts['Screening'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Screening'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Interview Aligned', candidates: statusCounts['Interview Aligned'] || statusCounts['Interview Scheduled'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Interview Aligned'] || statusCounts['Interview Scheduled'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Feedback Call', candidates: statusCounts['Feedback Call'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Feedback Call'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Finalized', candidates: statusCounts['Finalized'] || statusCounts['Offer Sent'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Finalized'] || statusCounts['Offer Sent'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Hired', candidates: statusCounts['Hired'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Hired'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'On Hold', candidates: statusCounts['On Hold'] || 0, percentage: totalApplications > 0 ? (((statusCounts['On Hold'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
    ];
    
    // Today's Calls by HR (using callingDate or assignDate)
    const today = new Date().toISOString().split('T')[0];
    const todayCalls = {};
    filteredRecords.forEach(record => {
      const callDate = record.callingDate ? new Date(record.callingDate).toISOString().split('T')[0] : 
                      (record.assignDate ? new Date(record.assignDate).toISOString().split('T')[0] : null);
      if (callDate === today) {
        const hrName = record.assignedTo || 'Unknown';
        todayCalls[hrName] = (todayCalls[hrName] || 0) + 1;
      }
    });
    
    const todaysCallsData = Object.entries(todayCalls).map(([name, calls]) => ({ name, calls }));
    
    // HR Performance Comparison
    const hrPerformance = {};
    filteredRecords.forEach(record => {
      const hrName = record.assignedTo || 'Unknown';
      if (!hrPerformance[hrName]) {
        hrPerformance[hrName] = { shortlisted: 0, positioned: 0 };
      }
      if (record.status === 'Shortlisted' || record.status === 'shortlisted') {
        hrPerformance[hrName].shortlisted++;
      }
      if (record.status === 'Finalized' || record.status === 'Offer Sent' || record.status === 'Hired') {
        hrPerformance[hrName].positioned++;
      }
    });
    
    const hrPerformanceData = Object.entries(hrPerformance).map(([name, data]) => ({
      name,
      shortlisted: data.shortlisted,
      positioned: data.positioned
    }));
    
    // Location Based Hiring Distribution
    const locationCounts = {};
    filteredRecords.forEach(record => {
      if (record.status === 'Hired' || record.hiringStatus === 'Hired') {
        const location = record.currentLocation || record.location || 'Unknown';
        locationCounts[location] = (locationCounts[location] || 0) + 1;
      }
    });
    
    const locationData = Object.entries(locationCounts).map(([name, value]) => ({ name, value }));
    
    // HR Activity Table
    const hrActivity = {};
    filteredRecords.forEach(record => {
      const hrName = record.assignedTo || 'Unknown';
      if (!hrActivity[hrName]) {
        hrActivity[hrName] = {
          totalCalls: 0,
          shortlisted: 0,
          interviewsScheduled: 0,
          offersSent: 0,
          hiresClosed: 0
        };
      }
      
      // Count calls (records with callingDate or assignDate)
      if (record.callingDate || record.assignDate) {
        hrActivity[hrName].totalCalls++;
      }
      
      if (record.status === 'Shortlisted' || record.status === 'shortlisted') {
        hrActivity[hrName].shortlisted++;
      }
      if (record.status === 'Interview Scheduled' || record.status === 'Interview Aligned') {
        hrActivity[hrName].interviewsScheduled++;
      }
      if (record.status === 'Offer Sent' || record.status === 'Finalized') {
        hrActivity[hrName].offersSent++;
      }
      if (record.status === 'Hired' || record.hiringStatus === 'Hired') {
        hrActivity[hrName].hiresClosed++;
      }
    });
    
    const hrActivityData = Object.entries(hrActivity).map(([hrName, data]) => {
      const conversion = data.totalCalls > 0 ? ((data.hiresClosed / data.totalCalls) * 100).toFixed(1) : 0;
      return {
        hrName,
        totalCalls: data.totalCalls,
        shortlisted: data.shortlisted,
        interviewsScheduled: data.interviewsScheduled,
        offersSent: data.offersSent,
        hiresClosed: data.hiresClosed,
        conversion: parseFloat(conversion),
        avgResponseTime: '2.5 hrs' // Would need additional data to calculate
      };
    });
    
    // Recent Activity Log (last 10 activities)
    const recentActivities = filteredRecords
      .sort((a, b) => {
        const dateA = new Date(a.assignDate || a.callingDate || a.createdAt || 0);
        const dateB = new Date(b.assignDate || b.callingDate || b.createdAt || 0);
        return dateB - dateA;
      })
      .slice(0, 10)
      .map(record => {
        let status = 'Pending';
        let statusColor = 'bg-yellow-500';
        
        if (record.status === 'Hired' || record.hiringStatus === 'Hired') {
          status = 'Approved';
          statusColor = 'bg-green-500';
        } else if (record.status === 'Rejected' || record.hiringStatus === 'Rejected') {
          status = 'Failed';
          statusColor = 'bg-red-500';
        } else if (record.status === 'Shortlisted' || record.status === 'Interview Scheduled') {
          status = 'Approved';
          statusColor = 'bg-green-500';
        }
        
        return {
          hr: record.assignedTo || 'Unknown',
          activity: record.status || 'Activity',
          status,
          statusColor
        };
      });
    
    res.json({
      success: true,
      data: {
        kpiCards: {
          totalActiveJobs,
          totalApplications,
          shortlisted,
          interviewsScheduled,
          offersSent,
          hired,
          avgTimeToHire,
          avgInterviewTime,
          avgOfferAcceptanceRate,
          offerRejectionRate
        },
        pipelineByHR: pipelineByHRArray,
        recruitmentFunnel,
        todaysCallsData,
        hrPerformanceData,
        locationData,
        hrActivityData,
        recentActivities,
        hrList,
        departments: ['Engineering', 'Sales', 'Marketing', 'HR', 'Operations'] // Would come from departments collection
      }
    });
  } catch (error) {
    console.error('HRMS recruitment analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get recruitment candidates (for Sourcing & Screening) - company-scoped
router.get('/recruitment/candidates', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { status, recruiter, experience, search, year } = req.query;
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    // Base query for status / recruiter / search (used for both year list and filtered results)
    const baseQuery = {};
    if (status && status !== 'All Status') {
      baseQuery.status = status;
    }
    if (recruiter && recruiter !== 'All Recruiters') {
      const recruiterRegex = new RegExp(`^${recruiter}$`, 'i');
      baseQuery.assignedTo = recruiterRegex;
    }
    if (search) {
      baseQuery.$or = [
        // Candidate core fields
        { candidateName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { contactNumber: { $regex: search, $options: 'i' } },
        { currentOrganisation: { $regex: search, $options: 'i' } },
        // Additional columns visible in the table
        { folderName: { $regex: search, $options: 'i' } },
        { assignedTo: { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } }
      ];
    }

    // First, fetch all matching candidates (without year constraint) to derive available years
    const allCandidates = await recruitmentCol.find(baseQuery).toArray();

    // Derive available years strictly from callingDate (HR wants year of callingDate column)
    const getCandidateYear = (candidate) => {
      const value = candidate.callingDate;
      if (!value) return null;
      const dateObj = value instanceof Date ? value : new Date(value);
      if (isNaN(dateObj)) return null;
      return dateObj.getFullYear();
    };

    const yearSet = new Set();
    allCandidates.forEach(candidate => {
      const candidateYear = getCandidateYear(candidate);
      if (candidateYear) {
        yearSet.add(candidateYear);
      }
    });
    const years = Array.from(yearSet).sort((a, b) => b - a).map(String);

    // Build final query including optional year range on callingDate
    const query = { ...baseQuery };
    if (year && year !== 'All Years') {
      const yearNum = parseInt(year, 10);
      if (!isNaN(yearNum)) {
        const start = new Date(`${yearNum}-01-01T00:00:00.000Z`);
        const end = new Date(`${yearNum + 1}-01-01T00:00:00.000Z`);
        query.callingDate = { $gte: start, $lt: end };
      }
    }

    const candidates = await recruitmentCol.find(query).toArray();
    
    // Filter by experience if provided (applied on the year-filtered result set)
    let filteredCandidates = candidates;
    if (experience && experience !== 'All Experience') {
      filteredCandidates = filteredCandidates.filter(candidate => {
        const exp = candidate.totalExperience || '';
        const expYears = parseFloat(exp) || 0;
        
        if (experience === '0-2 Years') return expYears >= 0 && expYears < 2;
        if (experience === '2-5 Years') return expYears >= 2 && expYears < 5;
        if (experience === '5-10 Years') return expYears >= 5 && expYears < 10;
        if (experience === '10+ Years') return expYears >= 10;
        return true;
      });
    }
    
    // Transform candidates to match frontend format
    // Filter out candidates without valid _id (they're not properly saved)
    const transformedCandidates = filteredCandidates
      .filter(candidate => candidate._id) // Only include candidates with valid _id
      .map((candidate) => {
        const statusColors = {
          'New': 'bg-blue-100 text-blue-700',
          'Shortlisted': 'bg-purple-100 text-purple-700',
          'In Interview': 'bg-yellow-100 text-yellow-700',
          'Interview Scheduled': 'bg-yellow-100 text-yellow-700',
          'Interview Aligned': 'bg-yellow-100 text-yellow-700',
          'Feedback Call': 'bg-orange-100 text-orange-700',
          'Finalized': 'bg-indigo-100 text-indigo-700',
          'Hired': 'bg-green-100 text-green-700',
          'On Hold': 'bg-slate-100 text-slate-700',
        };
        
        const status = candidate.status || 'New';
        const assignDate = candidate.assignDate ? new Date(candidate.assignDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
        
        return {
          id: candidate._id.toString(), // Always use _id.toString() - no fallback
          name: candidate.candidateName || 'Unknown',
          contact: candidate.contactNumber || 'N/A',
          email: candidate.email || 'N/A',
          organisation: candidate.currentOrganisation || 'N/A',
          education: candidate.education || 'N/A',
          experience: candidate.totalExperience || 'N/A',
          assignedTo: candidate.assignedTo || 'Unassigned',
          assignDate: assignDate,
          status: status,
          statusColor: statusColors[status] || 'bg-slate-100 text-slate-700',
          folderName: candidate.folderName || 'N/A'
        };
      });
    
    // Calculate KPIs
    const totalCandidates = transformedCandidates.length;
    const shortlisted = transformedCandidates.filter(c => c.status === 'Shortlisted').length;
    const inInterview = transformedCandidates.filter(c => c.status === 'In Interview' || c.status === 'Interview Scheduled' || c.status === 'Interview Aligned').length;
    const hired = transformedCandidates.filter(c => c.status === 'Hired').length;
    const onHold = transformedCandidates.filter(c => c.status === 'On Hold').length;

    // Recruiter dropdown: dynamic list from HR/recruiter users
    let hrList = ['All Recruiters'];
    try {
      const { getUsersCollection } = require('../../config/mongo');
      let companyName = company;
      if (!companyName || companyName === '1' || companyName === 'undefined') {
        companyName = 'Ecosoul Home';
      }
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      const names = employees
        .map(emp => emp.name || emp.firstName || 'Unknown')
        .filter(name => name && name !== 'Unknown');
      hrList = ['All Recruiters', ...Array.from(new Set(names))];
    } catch (err) {
      console.error('Error fetching HR list for recruitment candidates:', err);
    }
    
    res.json({
      success: true,
      data: {
        candidates: transformedCandidates,
        kpis: {
          totalCandidates,
          shortlisted,
          inInterview,
          hired,
          onHold
        },
        hrList,
        years
      }
    });
  } catch (error) {
    console.error('HRMS recruitment candidates error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get recruitment hiring candidates (for Recruitment & Hiring) - company-scoped
router.get('/recruitment/hiring', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { status, recruiter, search } = req.query;
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    const query = {
      $or: [
        { status: 'Finalized' },
        { interviewStatus: 'Finalized' },
        { status: 'Offer Sent' },
        { hiringStatus: { $exists: true, $ne: null } },
        { status: 'Rejected' },
        { status: 'Hired' }
      ]
    };
    if (status && status !== 'All Status') {
      if (status === 'Finalized') {
        query.$or = [{ status: 'Finalized' }, { interviewStatus: 'Finalized' }];
      } else {
        query.status = status;
      }
    }
    if (recruiter && recruiter !== 'All Recruiters') {
      const recruiterRegex = new RegExp(`^${recruiter}$`, 'i');
      query.assignedTo = recruiterRegex;
    }
    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { candidateName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { contactNumber: { $regex: search, $options: 'i' } },
          { currentOrganisation: { $regex: search, $options: 'i' } }
        ]
      });
    }
    
    const candidates = await recruitmentCol.find(query).toArray();
    
    // Transform candidates - filter out candidates without valid _id
    const transformedCandidates = candidates
      .filter(candidate => candidate._id) // Only include candidates with valid _id
      .map((candidate) => {
        const hiringStatus = candidate.hiringStatus || 'Awaiting';
        const hiringStatusColors = {
          'Hired': 'bg-green-100 text-green-700',
          'Rejected': 'bg-red-100 text-red-700',
          'Awaiting': 'bg-orange-100 text-orange-700'
        };
        
        return {
          id: candidate._id.toString(), // Always use _id.toString() - no fallback
          name: candidate.candidateName || 'Unknown',
          email: candidate.email || 'N/A',
          contact: candidate.contactNumber || 'N/A',
          organisation: candidate.currentOrganisation || 'N/A',
          assignedTo: candidate.assignedTo || 'Unassigned',
          interviewStatus: 'Finalized',
          interviewStatusColor: 'bg-green-100 text-green-700',
          hiringStatus: hiringStatus,
          hiringStatusColor: hiringStatusColors[hiringStatus] || 'bg-orange-100 text-orange-700',
          activeAction: hiringStatus.toLowerCase()
        };
      });
    
    // Calculate KPIs
    const totalCandidates = transformedCandidates.length;
    const hired = transformedCandidates.filter(c => c.hiringStatus === 'Hired').length;
    const rejected = transformedCandidates.filter(c => c.hiringStatus === 'Rejected').length;
    const awaiting = transformedCandidates.filter(c => c.hiringStatus === 'Awaiting').length;

    // Recruiter dropdown: dynamic list from HR/recruiter users
    let hrList = ['All Recruiters'];
    try {
      const { getUsersCollection } = require('../../config/mongo');
      let companyName = company;
      if (!companyName || companyName === '1' || companyName === 'undefined') {
        companyName = 'Ecosoul Home';
      }
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      const names = employees
        .map(emp => emp.name || emp.firstName || 'Unknown')
        .filter(name => name && name !== 'Unknown');
      hrList = ['All Recruiters', ...Array.from(new Set(names))];
    } catch (err) {
      console.error('Error fetching HR list for recruitment hiring:', err);
    }
    
    res.json({
      success: true,
      data: {
        candidates: transformedCandidates,
        kpis: {
          totalCandidates,
          hired,
          rejected,
          awaiting
        },
        hrList
      }
    });
  } catch (error) {
    console.error('HRMS recruitment hiring error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get onboarding candidates (for Onboarding) - company-scoped
router.get('/recruitment/onboarding', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { status, stage, recruiter, search } = req.query;
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    const query = {
      $or: [
        { hiringStatus: 'Hired' },
        { offerStatus: 'Accepted' },
        { status: 'Hired' }
      ]
    };
    if (status && status !== 'All Status') {
      if (status === 'Accepted') {
        query.$or = [{ offerStatus: 'Accepted' }, { hiringStatus: 'Hired' }];
      } else {
        query.offerStatus = status;
      }
    }
    if (stage && stage !== 'All Stages') {
      query.onboardingStage = stage;
    }
    if (recruiter && recruiter !== 'All Recruiters') {
      const recruiterRegex = new RegExp(`^${recruiter}$`, 'i');
      query.assignedTo = recruiterRegex;
    }
    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { candidateName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { contactNumber: { $regex: search, $options: 'i' } },
          { position: { $regex: search, $options: 'i' } }
        ]
      });
    }
    
    const candidates = await recruitmentCol.find(query).toArray();
    
    // Transform candidates - filter out candidates without valid _id
    const transformedCandidates = candidates
      .filter(candidate => candidate._id) // Only include candidates with valid _id
      .map((candidate) => {
        const offerStatus = candidate.offerStatus || (candidate.hiringStatus === 'Hired' ? 'Accepted' : 'Sent');
        const offerStatusColors = {
          'Accepted': 'bg-green-100 text-green-700',
          'Sent': 'bg-blue-100 text-blue-700',
          'Pending': 'bg-yellow-100 text-yellow-700',
          'Declined': 'bg-red-100 text-red-700'
        };
        
        const onboardingStage = candidate.onboardingStage || 'Offer';
        const onboardingStageColors = {
          'Offer': 'bg-blue-100 text-blue-700',
          'Form': 'bg-yellow-100 text-yellow-700',
          'Verification': 'bg-orange-100 text-orange-700',
          'Policy': 'bg-purple-100 text-purple-700',
          'Asset': 'bg-green-100 text-green-700'
        };
        
        const joiningDate = candidate.joiningDate ? new Date(candidate.joiningDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
        
        // Calculate progress based on stage
        const progressMap = {
          'Offer': 0,
          'Form': 15,
          'Verification': 65,
          'Policy': 15,
          'Asset': 100
        };
        const progress = candidate.progress || progressMap[onboardingStage] || 0;
        
        return {
          id: candidate._id.toString(), // Always use _id.toString() - no fallback
          name: candidate.candidateName || 'Unknown',
          email: candidate.email || 'N/A',
          contact: candidate.contactNumber || 'N/A',
          position: candidate.position || candidate.jobTitle || 'N/A',
          recruiter: candidate.assignedTo || 'Unassigned',
          offerStatus: offerStatus,
          offerStatusColor: offerStatusColors[offerStatus] || 'bg-slate-100 text-slate-700',
          joiningDate: joiningDate,
          onboardingStage: onboardingStage,
          onboardingStageColor: onboardingStageColors[onboardingStage] || 'bg-slate-100 text-slate-700',
          progress: progress
        };
      });
    
    // Calculate KPIs
    const totalOnboardings = transformedCandidates.length;
    const pendingOffers = transformedCandidates.filter(c => c.offerStatus === 'Sent' || c.offerStatus === 'Pending').length;
    const offersAccepted = transformedCandidates.filter(c => c.offerStatus === 'Accepted').length;
    const offersDeclined = transformedCandidates.filter(c => c.offerStatus === 'Declined').length;
    const completedOnboardings = transformedCandidates.filter(c => c.onboardingStage === 'Asset' && c.progress === 100).length;

    // Recruiter dropdown: dynamic list from HR/recruiter users
    let hrList = ['All Recruiters'];
    try {
      const { getUsersCollection } = require('../../config/mongo');
      let companyName = company;
      if (!companyName || companyName === '1' || companyName === 'undefined') {
        companyName = 'Ecosoul Home';
      }
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      const names = employees
        .map(emp => emp.name || emp.firstName || 'Unknown')
        .filter(name => name && name !== 'Unknown');
      hrList = ['All Recruiters', ...Array.from(new Set(names))];
    } catch (err) {
      console.error('Error fetching HR list for onboarding:', err);
    }
    
    res.json({
      success: true,
      data: {
        candidates: transformedCandidates,
        kpis: {
          totalOnboardings,
          pendingOffers,
          offersAccepted,
          offersDeclined,
          completedOnboardings
        },
        hrList
      }
    });
  } catch (error) {
    console.error('HRMS recruitment onboarding error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get single recruitment candidate by ID - company-scoped
router.get('/recruitment/candidates/:id', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const candidateId = req.params.id;
    
    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'Candidate ID is required'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    if (!ObjectId.isValid(candidateId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid candidate ID format'
      });
    }
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    const candidate = await recruitmentCol.findOne({ _id: new ObjectId(candidateId) });
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    // Format dates for frontend
    const formatDate = (date) => {
      if (!date) return null;
      const d = new Date(date);
      return d.toISOString().split('T')[0];
    };
    
    // Return all candidate fields
    res.json({
      success: true,
      data: {
        id: candidate._id?.toString(),
        candidateName: candidate.candidateName || '',
        contactNumber: candidate.contactNumber || '',
        email: candidate.email || '',
        currentLocation: candidate.currentLocation || '',
        callingDate: formatDate(candidate.callingDate),
        assignDate: formatDate(candidate.assignDate),
        currentOrganisation: candidate.currentOrganisation || '',
        education: candidate.education || '',
        totalExperience: candidate.totalExperience || '',
        assignedTo: candidate.assignedTo || '',
        status: candidate.status || 'New',
        currentCTCFixed: candidate.currentCTCFixed || 0,
        currentCTCInHand: candidate.currentCTCInHand || 0,
        expectedCTC: candidate.expectedCTC || 0,
        noticePeriod: candidate.noticePeriod || '',
        willingToWorkInStartup: candidate.willingToWorkInStartup || 'Yes',
        communicationSkills: candidate.communicationSkills || '',
        recruiterFeedback: candidate.recruiterFeedback || '',
        interviewerFeedback: candidate.interviewerFeedback || '',
        remark: candidate.remark || '',
        company: candidate.company || null,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt
      }
    });
  } catch (error) {
    console.error('HRMS get candidate by ID error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Create/Add new recruitment candidate - company-scoped
router.post('/recruitment/candidates', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const candidateData = req.body;
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    // Prepare candidate document
    const candidate = {
      candidateName: candidateData.candidateName || '',
      contactNumber: candidateData.contactNumber || '',
      email: candidateData.email || '',
      currentLocation: candidateData.currentLocation || '',
      callingDate: candidateData.callingDate ? new Date(candidateData.callingDate) : new Date(),
      assignDate: candidateData.assignDate ? new Date(candidateData.assignDate) : new Date(),
      currentOrganisation: candidateData.currentOrganisation || '',
      education: candidateData.education || '',
      totalExperience: candidateData.totalExperience || '',
      assignedTo: candidateData.assignedTo || '',
      status: candidateData.status || 'New',
      currentCTCFixed: candidateData.currentCTCFixed || 0,
      currentCTCInHand: candidateData.currentCTCInHand || 0,
      expectedCTC: candidateData.expectedCTC || 0,
      noticePeriod: candidateData.noticePeriod || '',
      willingToWorkInStartup: candidateData.willingToWorkInStartup || 'Yes',
      communicationSkills: candidateData.communicationSkills || '',
      recruiterFeedback: candidateData.recruiterFeedback || '',
      interviewerFeedback: candidateData.interviewerFeedback || '',
      remark: candidateData.remark || '',
      folderName: candidateData.folderName || '',
      company: candidateData.company || company || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Insert candidate
    const result = await recruitmentCol.insertOne(candidate);
    
    res.json({
      success: true,
      message: 'Candidate added successfully',
      data: {
        id: result.insertedId.toString(),
        ...candidate
      }
    });
  } catch (error) {
    console.error('HRMS add candidate error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Bulk upload recruitment candidates
router.post('/recruitment/candidates/bulk-upload', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { candidates, company: candidateCompany } = req.body;
    
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No candidates provided'
      });
    }

    // Get HRMS database - use default if no company specified (for admin portal)
    const db = await getHrmsDb(company || candidateCompany || null);
    const recruitmentCol = db.collection('recruitment');
    
    const insertedCandidates = [];
    const errors = [];
    
    // Process each candidate
    for (let i = 0; i < candidates.length; i++) {
      const candidateData = candidates[i];
      
      try {
        // Prepare candidate document
        const candidate = {
          candidateName: candidateData.candidateName || '',
          contactNumber: candidateData.contactNumber || '',
          email: candidateData.email || '',
          currentLocation: candidateData.currentLocation || '',
          callingDate: candidateData.callingDate ? new Date(candidateData.callingDate) : new Date(),
          assignDate: candidateData.assignDate ? new Date(candidateData.assignDate) : new Date(),
          currentOrganisation: candidateData.currentOrganisation || '',
          education: candidateData.education || '',
          totalExperience: candidateData.totalExperience || '',
          assignedTo: candidateData.assignedTo || '',
          status: candidateData.status || 'New',
          currentCTCFixed: parseFloat(candidateData.currentCTCFixed) || 0,
          currentCTCInHand: parseFloat(candidateData.currentCTCInHand) || 0,
          expectedCTC: parseFloat(candidateData.expectedCTC) || 0,
          noticePeriod: candidateData.noticePeriod || '',
          willingToWorkInStartup: candidateData.willingToWorkInStartup || 'Yes',
          communicationSkills: candidateData.communicationSkills || '',
          recruiterFeedback: candidateData.recruiterFeedback || '',
          interviewerFeedback: candidateData.interviewerFeedback || '',
          remark: candidateData.remark || '',
          folderName: candidateData.folderName || '',
          company: candidateData.company || company || candidateCompany || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Insert candidate
        const result = await recruitmentCol.insertOne(candidate);
        insertedCandidates.push({
          id: result.insertedId.toString(),
          ...candidate
        });
      } catch (error) {
        console.error(`Error inserting candidate ${i + 1}:`, error);
        errors.push({
          row: i + 2, // +2 because header is row 1 and index is 0-based
          errors: [error.message || 'Failed to insert candidate']
        });
      }
    }
    
    res.json({
      success: true,
      message: `Successfully imported ${insertedCandidates.length} candidate(s)${errors.length > 0 ? `. ${errors.length} candidate(s) had errors.` : ''}`,
      data: {
        created: insertedCandidates.length,
        candidates: insertedCandidates,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    console.error('HRMS bulk upload candidates error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Update recruitment candidate
router.put('/recruitment/candidates/:id', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const candidateId = req.params.id;
    const candidateData = req.body;
    
    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'Candidate ID is required'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    // Validate ObjectId format
    if (!ObjectId.isValid(candidateId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid candidate ID format'
      });
    }
    
    // Prepare update document
    const updateData = {
      ...candidateData,
      updatedAt: new Date()
    };
    
    // Convert date strings to Date objects if present
    if (updateData.callingDate && typeof updateData.callingDate === 'string') {
      updateData.callingDate = new Date(updateData.callingDate);
    }
    if (updateData.assignDate && typeof updateData.assignDate === 'string') {
      updateData.assignDate = new Date(updateData.assignDate);
    }
    if (updateData.joiningDate && typeof updateData.joiningDate === 'string') {
      updateData.joiningDate = new Date(updateData.joiningDate);
    }
    if (updateData.interviewDate && typeof updateData.interviewDate === 'string') {
      updateData.interviewDate = new Date(updateData.interviewDate);
    }
    if (updateData.interviewScheduledAt && typeof updateData.interviewScheduledAt === 'string') {
      updateData.interviewScheduledAt = new Date(updateData.interviewScheduledAt);
    }
    
    // If company is not specified, search across all databases
    let result = null;
    if (!company || company === 'all' || company === 'undefined') {
      const dbs = await getAllHrmsDbs();
      for (const db of dbs) {
        const recruitmentCol = db.collection('recruitment');
        result = await recruitmentCol.updateOne(
          { _id: new ObjectId(candidateId) },
          { $set: updateData }
        );
        if (result.matchedCount > 0) {
          break; // Found and updated, exit loop
        }
      }
    } else {
      // Get HRMS database for specific company
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      result = await recruitmentCol.updateOne(
        { _id: new ObjectId(candidateId) },
        { $set: updateData }
      );
    }
    
    if (!result || result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    // Fetch the updated candidate to return all fields
    let updatedCandidate = null;
    if (!company || company === 'all' || company === 'undefined') {
      const dbs = await getAllHrmsDbs();
      for (const db of dbs) {
        const recruitmentCol = db.collection('recruitment');
        updatedCandidate = await recruitmentCol.findOne({ _id: new ObjectId(candidateId) });
        if (updatedCandidate) {
          break;
        }
      }
    } else {
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      updatedCandidate = await recruitmentCol.findOne({ _id: new ObjectId(candidateId) });
    }
    
    // Format dates for frontend
    const formatDate = (date) => {
      if (!date) return null;
      const d = new Date(date);
      return d.toISOString().split('T')[0];
    };
    
    // Return all candidate fields
    res.json({
      success: true,
      message: 'Candidate updated successfully',
      data: {
        id: updatedCandidate._id?.toString(),
        candidateName: updatedCandidate.candidateName || '',
        contactNumber: updatedCandidate.contactNumber || '',
        email: updatedCandidate.email || '',
        currentLocation: updatedCandidate.currentLocation || '',
        callingDate: formatDate(updatedCandidate.callingDate),
        assignDate: formatDate(updatedCandidate.assignDate),
        currentOrganisation: updatedCandidate.currentOrganisation || '',
        education: updatedCandidate.education || '',
        totalExperience: updatedCandidate.totalExperience || '',
        assignedTo: updatedCandidate.assignedTo || '',
        status: updatedCandidate.status || 'New',
        currentCTCFixed: updatedCandidate.currentCTCFixed || 0,
        currentCTCInHand: updatedCandidate.currentCTCInHand || 0,
        expectedCTC: updatedCandidate.expectedCTC || 0,
        noticePeriod: updatedCandidate.noticePeriod || '',
        willingToWorkInStartup: updatedCandidate.willingToWorkInStartup || 'Yes',
        communicationSkills: updatedCandidate.communicationSkills || '',
        recruiterFeedback: updatedCandidate.recruiterFeedback || '',
        interviewerFeedback: updatedCandidate.interviewerFeedback || '',
        remark: updatedCandidate.remark || '',
        company: updatedCandidate.company || null,
        createdAt: updatedCandidate.createdAt,
        updatedAt: updatedCandidate.updatedAt
      }
    });
  } catch (error) {
    console.error('HRMS update candidate error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Delete recruitment candidate
router.delete('/recruitment/candidates/:id', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const candidateId = req.params.id;
    
    // Validate candidateId exists
    if (!candidateId || candidateId === 'undefined' || candidateId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Candidate ID is required'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    // If company is not specified, search across all databases
    let result = null;
    
    // Check if candidateId is a valid ObjectId
    if (ObjectId.isValid(candidateId)) {
      // Try to delete by ObjectId
      if (!company || company === 'all' || company === 'undefined') {
        const dbs = await getAllHrmsDbs();
        for (const db of dbs) {
          const recruitmentCol = db.collection('recruitment');
          result = await recruitmentCol.deleteOne({ _id: new ObjectId(candidateId) });
          if (result.deletedCount > 0) {
            break; // Found and deleted, exit loop
          }
        }
      } else {
        // Get HRMS database for specific company
        const db = await getHrmsDb(company);
        const recruitmentCol = db.collection('recruitment');
        result = await recruitmentCol.deleteOne({ _id: new ObjectId(candidateId) });
      }
    } else {
      // If not a valid ObjectId, it might be a numeric fallback ID from frontend
      // In this case, we can't reliably delete it as it's not a real database ID
      // Return a helpful error message
      return res.status(400).json({
        success: false,
        error: 'Invalid candidate ID. This candidate may not be properly saved in the database. Please refresh the page and try again.'
      });
    }
    
    if (!result || result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Candidate deleted successfully'
    });
  } catch (error) {
    console.error('HRMS delete candidate error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Bulk delete recruitment candidates
router.delete('/recruitment/candidates', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { ids } = req.body; // Array of candidate IDs
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of candidate IDs to delete'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    // Filter out invalid ObjectIds
    const validIds = ids.filter(id => ObjectId.isValid(id));
    
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid candidate IDs provided'
      });
    }
    
    // Convert to ObjectIds
    const objectIds = validIds.map(id => new ObjectId(id));
    
    let totalDeleted = 0;
    
    // If company is not specified, search across all databases
    if (!company || company === 'all' || company === 'undefined') {
      const dbs = await getAllHrmsDbs();
      for (const db of dbs) {
        const recruitmentCol = db.collection('recruitment');
        const result = await recruitmentCol.deleteMany({ _id: { $in: objectIds } });
        totalDeleted += result.deletedCount;
      }
    } else {
      // Get HRMS database for specific company
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      const result = await recruitmentCol.deleteMany({ _id: { $in: objectIds } });
      totalDeleted = result.deletedCount;
    }
    
    if (totalDeleted === 0) {
      return res.status(404).json({
        success: false,
        error: 'No candidates found to delete'
      });
    }
    
    res.json({
      success: true,
      message: `Successfully deleted ${totalDeleted} candidate(s)`,
      deletedCount: totalDeleted
    });
  } catch (error) {
    console.error('HRMS bulk delete candidates error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Get all recruiters/HR
router.get('/recruitment/recruiters', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    
    const { getUsersCollection } = require('../../config/mongo');
    let recruiters = [];
    const recruiterMap = new Map(); // Use Map to avoid duplicates
    
    try {
      if (!company || company === 'all' || company === 'undefined') {
        // Get recruiters from all companies for admin portal
        const companyNames = ['Ecosoul Home', 'Thrive'];
        for (const companyName of companyNames) {
          try {
            const usersCol = await getUsersCollection(null, companyName);
            const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
            employees.forEach(emp => {
              const name = emp.name || emp.firstName;
              if (name && name !== 'Unknown') {
                // Use email as key to avoid duplicates
                const key = emp.email || name;
                if (!recruiterMap.has(key)) {
                  recruiterMap.set(key, {
                    id: emp._id?.toString(),
                    name: name,
                    email: emp.email || '',
                    role: emp.role || 'recruiter',
                    phone: emp.phone || emp.mobile || ''
                  });
                }
              }
            });
          } catch (err) {
            // Continue to next company
          }
        }
        recruiters = Array.from(recruiterMap.values());
      } else {
        // Get recruiters from specific company
        const usersCol = await getUsersCollection(null, company);
        const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
        recruiters = employees.map(emp => ({
          id: emp._id?.toString(),
          name: emp.name || emp.firstName || 'Unknown',
          email: emp.email || '',
          role: emp.role || 'recruiter',
          phone: emp.phone || emp.mobile || ''
        })).filter(emp => emp.name !== 'Unknown');
      }
    } catch (err) {
      console.error('Error fetching recruiters:', err);
    }
    
    res.json({
      success: true,
      data: recruiters
    });
  } catch (error) {
    console.error('HRMS get recruiters error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Add new recruiter
router.post('/recruitment/recruiters', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { name, email, phone, role } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
    }
    
    const { getUsersCollection } = require('../../config/mongo');
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    const usersCol = await getUsersCollection(null, companyName);
    
    // Check if email already exists
    const existing = await usersCol.findOne({ email: email.toLowerCase() });
    if (existing) {
      // If a user already exists with this email, update them to be a recruiter
      const updatedRecruiter = {
        name: name,
        firstName: name.split(' ')[0] || name,
        lastName: name.split(' ').slice(1).join(' ') || '',
        phone: phone || existing.phone || '',
        role: role || 'recruiter',
        status: 'active',
        updatedAt: new Date()
      };

      await usersCol.updateOne(
        { _id: existing._id },
        { $set: updatedRecruiter }
      );

      return res.json({
        success: true,
        message: 'Recruiter updated successfully',
        data: {
          id: existing._id.toString(),
          email: existing.email,
          ...updatedRecruiter
        }
      });
    }
    
    // Create new recruiter
    const recruiter = {
      name: name,
      firstName: name.split(' ')[0] || name,
      lastName: name.split(' ').slice(1).join(' ') || '',
      email: email.toLowerCase(),
      phone: phone || '',
      role: role || 'recruiter',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await usersCol.insertOne(recruiter);
    
    res.json({
      success: true,
      message: 'Recruiter added successfully',
      data: {
        id: result.insertedId.toString(),
        ...recruiter
      }
    });
  } catch (error) {
    console.error('HRMS add recruiter error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Update recruiter
router.put('/recruitment/recruiters/:id', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const recruiterId = req.params.id;
    const { name, email, phone, role } = req.body;
    
    if (!recruiterId) {
      return res.status(400).json({
        success: false,
        error: 'Recruiter ID is required'
      });
    }
    
    const { getUsersCollection } = require('../../config/mongo');
    const { ObjectId } = require('mongodb');
    
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    const usersCol = await getUsersCollection(null, companyName);
    
    // Validate ObjectId
    if (!ObjectId.isValid(recruiterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid recruiter ID format'
      });
    }
    
    // Check if email is being changed and if it already exists
    if (email) {
      const existing = await usersCol.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: new ObjectId(recruiterId) }
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Recruiter with this email already exists'
        });
      }
    }
    
    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name) {
      updateData.name = name;
      updateData.firstName = name.split(' ')[0] || name;
      updateData.lastName = name.split(' ').slice(1).join(' ') || '';
    }
    if (email) {
      updateData.email = email.toLowerCase();
    }
    if (phone !== undefined) {
      updateData.phone = phone;
    }
    if (role) {
      updateData.role = role;
    }
    
    // Update recruiter
    const result = await usersCol.updateOne(
      { _id: new ObjectId(recruiterId) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Recruiter not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Recruiter updated successfully'
    });
  } catch (error) {
    console.error('HRMS update recruiter error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Delete recruiter
router.delete('/recruitment/recruiters/:id', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const recruiterId = req.params.id;
    
    if (!recruiterId) {
      return res.status(400).json({
        success: false,
        error: 'Recruiter ID is required'
      });
    }
    
    const { getUsersCollection } = require('../../config/mongo');
    const { ObjectId } = require('mongodb');
    
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    const usersCol = await getUsersCollection(null, companyName);
    
    // Validate ObjectId
    if (!ObjectId.isValid(recruiterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid recruiter ID format'
      });
    }
    
    // Check if recruiter is assigned to any candidates
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    const recruiter = await usersCol.findOne({ _id: new ObjectId(recruiterId) });
    
    if (recruiter) {
      const recruiterName = recruiter.name || recruiter.firstName || '';
      const assignedCandidates = await recruitmentCol.countDocuments({ assignedTo: recruiterName });
      
      if (assignedCandidates > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete recruiter. ${assignedCandidates} candidate(s) are assigned to this recruiter. Please reassign them first.`
        });
      }
    }
    
    // Delete recruiter
    const result = await usersCol.deleteOne({ _id: new ObjectId(recruiterId) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Recruiter not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Recruiter deleted successfully'
    });
  } catch (error) {
    console.error('HRMS delete recruiter error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Get all scheduled interviews
router.get('/recruitment/interviews', async (req, res) => {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { status, interviewer, date, search } = req.query;
    
    // For HRMS Admin Portal - get data from all companies if no company specified
    let candidates = [];
    
    if (!company || company === 'all' || company === 'undefined') {
      // Get all databases and aggregate data
      const dbs = await getAllHrmsDbs();
      const allCandidatesPromises = dbs.map(async (db) => {
        const recruitmentCol = db.collection('recruitment');
        
        // Build query - only candidates with scheduled interviews
        const query = {
          $or: [
            { status: 'Interview Scheduled' },
            { interviewDate: { $exists: true, $ne: null } },
            { interviewScheduledAt: { $exists: true, $ne: null } }
          ]
        };
        
        // Filter by status
        if (status && status !== 'All Status') {
          query.status = status;
        }
        
        // Filter by interviewer
        if (interviewer && interviewer !== 'All Interviewers') {
          query.interviewer = interviewer;
        }
        
        // Filter by date
        if (date) {
          const startDate = new Date(date);
          startDate.setHours(0, 0, 0, 0);
          const endDate = new Date(date);
          endDate.setHours(23, 59, 59, 999);
          
          // Add date filter to existing query
          const dateQuery = {
            $or: [
              { interviewDate: { $gte: startDate, $lte: endDate } },
              { interviewScheduledAt: { $gte: startDate, $lte: endDate } }
            ]
          };
          
          if (query.$and) {
            query.$and.push(dateQuery);
          } else {
            query.$and = [dateQuery];
          }
        }
        
        // Search filter
        if (search) {
          query.$and = query.$and || [];
          query.$and.push({
            $or: [
              { candidateName: { $regex: search, $options: 'i' } },
              { email: { $regex: search, $options: 'i' } },
              { contactNumber: { $regex: search, $options: 'i' } },
              { interviewer: { $regex: search, $options: 'i' } }
            ]
          });
        }
        
        return await recruitmentCol.find(query).toArray();
      });
      
      const allCandidatesArrays = await Promise.all(allCandidatesPromises);
      candidates = allCandidatesArrays.flat();
    } else {
      // Get HRMS database for specific company
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      
      // Build query - only candidates with scheduled interviews
      const query = {
        $or: [
          { status: 'Interview Scheduled' },
          { interviewDate: { $exists: true, $ne: null } },
          { interviewScheduledAt: { $exists: true, $ne: null } }
        ]
      };
      
      // Filter by status
      if (status && status !== 'All Status') {
        query.status = status;
      }
      
      // Filter by interviewer
      if (interviewer && interviewer !== 'All Interviewers') {
        query.interviewer = interviewer;
      }
      
      // Filter by date
      if (date) {
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
        
        // Add date filter to existing query
        const dateQuery = {
          $or: [
            { interviewDate: { $gte: startDate, $lte: endDate } },
            { interviewScheduledAt: { $gte: startDate, $lte: endDate } }
          ]
        };
        
        if (query.$and) {
          query.$and.push(dateQuery);
        } else {
          query.$and = [dateQuery];
        }
      }
      
      // Search filter
      if (search) {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { candidateName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { contactNumber: { $regex: search, $options: 'i' } },
            { interviewer: { $regex: search, $options: 'i' } }
          ]
        });
      }
      
      candidates = await recruitmentCol.find(query).toArray();
    }
    
    // Transform to interview format
    const interviews = candidates
      .filter(candidate => candidate.interviewDate || candidate.interviewScheduledAt)
      .map((candidate, index) => {
        const interviewDate = candidate.interviewDate || candidate.interviewScheduledAt;
        const interviewTime = candidate.interviewTime || '';
        const scheduledDateTime = interviewDate ? new Date(interviewDate) : null;
        
        // Determine interview status
        let interviewStatus = 'Scheduled';
        if (scheduledDateTime) {
          const now = new Date();
          if (scheduledDateTime < now) {
            interviewStatus = 'Completed';
          } else if (scheduledDateTime.getTime() - now.getTime() < 24 * 60 * 60 * 1000) {
            interviewStatus = 'Upcoming';
          }
        }
        
        return {
          id: candidate._id?.toString() || index + 1,
          candidateId: candidate._id?.toString(),
          candidateName: candidate.candidateName || 'Unknown',
          email: candidate.email || 'N/A',
          contact: candidate.contactNumber || 'N/A',
          position: candidate.position || candidate.jobTitle || 'N/A',
          interviewer: candidate.interviewer || 'N/A',
          interviewDate: candidate.interviewDate || candidate.interviewScheduledAt,
          interviewTime: candidate.interviewTime || 'N/A',
          meetingLink: candidate.meetingLink || 'N/A',
          status: candidate.status || 'Interview Scheduled',
          interviewStatus: interviewStatus,
          scheduledAt: candidate.interviewScheduledAt || candidate.interviewDate,
          assignedTo: candidate.assignedTo || 'Unassigned'
        };
      })
      .sort((a, b) => {
        // Sort by scheduled date/time
        const dateA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
        const dateB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
        return dateB - dateA; // Most recent first
      });
    
    // Get unique interviewers for filter
    const interviewers = [...new Set(interviews.map(i => i.interviewer).filter(Boolean))];
    
    res.json({
      success: true,
      data: {
        interviews: interviews,
        interviewers: ['All Interviewers', ...interviewers]
      }
    });
  } catch (error) {
    console.error('HRMS get interviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;


