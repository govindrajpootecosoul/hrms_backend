const { connectMongo } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');

/** `dateRange` may be Date, object, or string — .split only exists on strings */
function splitDateRangeParts(dateRange) {
  if (dateRange == null || dateRange === '') return null;
  const s = typeof dateRange === 'string' ? dateRange : String(dateRange);
  const parts = s.split(' - ');
  return parts.length === 2 ? parts : null;
}

/** Express can give string[] for duplicate query keys — use first value */
function firstQueryValue(val, fallback) {
  if (val == null || val === '') return fallback;
  const v = Array.isArray(val) ? val[0] : val;
  const s = String(v).trim();
  return s || fallback;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseCheckTime(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return isValidDate(d) ? d : null;
}

async function listAttendance(req, res) {
  try {
    const companyName = requireCompany(req, res);
    if (!companyName) return;
    await connectMongo();

    const date = firstQueryValue(req.query.date, new Date().toISOString().split('T')[0]);
    const department = firstQueryValue(req.query.department, 'all');
    
    // Get employee database where check-ins are stored (use normalized company)
    const db = await getEmployeeDbForHrms(companyName);
    let col = db.collection('employee_checkins');

    // Get employees collection for employee details
    const { getUsersCollection } = require('../../../config/mongo');
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
        if (!isValidDate(todayDate)) {
          console.warn('[attendance] Invalid date query, skipping checkInTime range fallback:', date);
        } else {
          const startOfDay = new Date(todayDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(todayDate);
          endOfDay.setHours(23, 59, 59, 999);
          const alternativeQuery = {
            checkInTime: {
              $gte: startOfDay,
              $lte: endOfDay,
            },
          };
          checkIns = await col.find(alternativeQuery).sort({ checkInTime: -1 }).toArray();
          console.log(`[attendance] Found ${checkIns.length} check-ins using checkInTime range query (company DB)`);
        }
      } catch (e) {
        console.error('[attendance] Alternative query by checkInTime failed:', e);
      }
    }
    
    // Get only this company's employees (employee_details lives in main_db)
    const allEmployees = await usersCol.find({ company: companyName }).toArray();
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
    const attendanceRecords = checkIns
      .filter((record) => record && record._id != null)
      .map((record) => {
      const checkInTime = parseCheckTime(record.checkInTime);
      const checkOutTime = parseCheckTime(record.checkOutTime);
      
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
      error:
        process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function attendanceStats(req, res) {
  try {
    const effectiveCompany = requireCompany(req, res);
    if (!effectiveCompany) return;
    await connectMongo();
    const date = firstQueryValue(req.query.date, new Date().toISOString().split('T')[0]);
    
    const db = await getEmployeeDbForHrms(effectiveCompany);
    let col = db.collection('employee_checkins');

    const { getUsersCollection } = require('../../../config/mongo');
    const companyName = effectiveCompany;
    let totalEmployees = 0;
    let employeesList = [];
    try {
      const usersCol = await getUsersCollection(null, companyName);
      // IMPORTANT: employee_details is in main_db, but must be filtered by company
      employeesList = await usersCol.find({ company: companyName }).toArray();
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
        if (!isValidDate(todayDate)) {
          console.warn('[attendance/stats] Invalid date, skipping checkInTime range fallback:', date);
        } else {
          const startOfDay = new Date(todayDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(todayDate);
          endOfDay.setHours(23, 59, 59, 999);
          const alternativeQuery = {
            checkInTime: {
              $gte: startOfDay,
              $lte: endOfDay,
            },
          };
          todayCheckIns = await col.find(alternativeQuery).toArray();
          console.log(`[attendance/stats] Found ${todayCheckIns.length} check-in records using checkInTime range query (company DB)`);
        }
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
      const rangeParts = splitDateRangeParts(leave.dateRange);
      if (rangeParts) {
        const parts = rangeParts;
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
    wfhRequests.forEach((wfhReq) => {
      const wfhParts = splitDateRangeParts(wfhReq.dateRange);
      if (wfhParts) {
        const parts = wfhParts;
        try {
            const fromDate = new Date(parts[0].trim());
            const toDate = new Date(parts[1].trim());
            const todayDate = new Date(todayDateStr);
            
            fromDate.setHours(0, 0, 0, 0);
            toDate.setHours(0, 0, 0, 0);
            todayDate.setHours(0, 0, 0, 0);
            
            if (todayDate >= fromDate && todayDate <= toDate) {
              const reqEmpId = wfhReq.employeeId;
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
            console.error('[attendance/stats] Error parsing WFH request date range:', wfhReq.dateRange, e);
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
      error:
        process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

module.exports = {
  listAttendance,
  attendanceStats,
};
