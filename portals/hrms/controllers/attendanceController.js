const { connectMongo } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');
const { getDb, LOGIN_DB_NAME } = require('../../../config/mongo');

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

function parseYyyyMmDd(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return isValidDate(d) ? d : null;
}

function getUtcDayRange(dateStr) {
  const d = parseYyyyMmDd(dateStr);
  if (!d) return null;
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function timeHmFromDate(d) {
  if (!isValidDate(d)) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeHmToDate(dateStr, hm) {
  if (!dateStr || !hm) return null;
  const [hh, mm] = String(hm).split(':').map((n) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const base = parseYyyyMmDd(dateStr);
  if (!base) return null;
  const d = new Date(base);
  d.setHours(hh, mm, 0, 0);
  return isValidDate(d) ? d : null;
}

function isLateByPunchIn(checkInTime) {
  if (!isValidDate(checkInTime)) return false;
  // Requirement: 09:00–09:35 is NOT late; after 09:35 is late.
  const mins = checkInTime.getHours() * 60 + checkInTime.getMinutes();
  return mins > 9 * 60 + 35;
}

function hmToMinutes(hm) {
  if (!hm) return null;
  const parts = String(hm).split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minTimeHm(a, b) {
  const am = hmToMinutes(a);
  const bm = hmToMinutes(b);
  if (am == null) return b || null;
  if (bm == null) return a || null;
  return am <= bm ? a : b;
}

function maxTimeHm(a, b) {
  const am = hmToMinutes(a);
  const bm = hmToMinutes(b);
  if (am == null) return b || null;
  if (bm == null) return a || null;
  return am >= bm ? a : b;
}

function normalizeEmpCode(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s ? s : null;
}

async function getMachineAttendanceForDay(dateStr) {
  const range = getUtcDayRange(dateStr);
  if (!range) return [];
  const dbNamesToTry = Array.from(
    new Set([LOGIN_DB_NAME, 'main_db'].filter((n) => n && String(n).trim() !== ''))
  );
  const collectionNamesToTry = ['machine_attendance_reports', 'machine _attendance_reports'];
  const datePrefixRegex = new RegExp(`^${String(dateStr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

  const all = [];
  for (const dbName of dbNamesToTry) {
    try {
      const db = await getDb(dbName);
      const existingCols = new Set((await db.listCollections().toArray()).map((c) => c.name));
      for (const colName of collectionNamesToTry) {
        if (!existingCols.has(colName)) continue;
        const col = db.collection(colName);

        // Your DB stores `date` as ISO string (e.g. "2026-04-01T00:00:00.000Z") in many docs.
        // Support both: Date range (Date type) and prefix match (string type).
        let docs = await col
          .find({
            $or: [
              { date: { $gte: range.start, $lte: range.end } },
              { date: datePrefixRegex },
              { date: dateStr },
              { date: `${dateStr}T00:00:00.000Z` },
            ],
          })
          .toArray();

        all.push(...docs);
      }
    } catch (e) {
      // Ignore missing DB/collection or connectivity issues for fallback DBs
      console.warn(`[machine_attendance_reports] Skipping db '${dbName}':`, e.message);
    }
  }
  return all;
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
    const employeeByEmployeeId = new Map(); // employeeId/emailPrefix -> employee info
    const employeeByEmpCode = new Map(); // emp_code -> employee info
    allEmployees.forEach((emp) => {
      const canonicalEmployeeId = emp.employeeId || emp.email?.split('@')[0] || '';
      const empCode = normalizeEmpCode(emp.emp_code);
      const info = {
        name: emp.name || emp.firstName || 'Unknown',
        department: emp.department || 'General',
        employeeId: canonicalEmployeeId || null,
        empCode: empCode || null,
      };
      if (canonicalEmployeeId) employeeByEmployeeId.set(canonicalEmployeeId, info);
      if (emp.email) employeeByEmployeeId.set(emp.email, info);
      if (emp.email?.includes('@')) employeeByEmployeeId.set(emp.email.split('@')[0], info);
      if (empCode) employeeByEmpCode.set(empCode, info);
    });

    // Machine attendance (main_db.machine_attendance_reports)
    const machineReports = await getMachineAttendanceForDay(date);
    const machineByEmpCode = new Map(); // emp_code -> best report
    for (const r of machineReports) {
      const empCode = normalizeEmpCode(r.emp_code);
      if (!empCode) continue;
      // Company scoping: only include machine records whose emp_code exists in this company's employee_details
      if (!employeeByEmpCode.has(empCode)) continue;
      // Prefer "Present" over anything else, and prefer record with punch_in.
      const existing = machineByEmpCode.get(empCode);
      if (!existing) {
        machineByEmpCode.set(empCode, r);
        continue;
      }
      const exStatus = String(existing.status || '').toLowerCase();
      const rStatus = String(r.status || '').toLowerCase();
      const exPresent = exStatus === 'present';
      const rPresent = rStatus === 'present';
      if (!exPresent && rPresent) {
        machineByEmpCode.set(empCode, r);
        continue;
      }
      if (exPresent === rPresent) {
        const exHasIn = existing.punch_in != null && String(existing.punch_in).trim() !== '';
        const rHasIn = r.punch_in != null && String(r.punch_in).trim() !== '';
        if (!exHasIn && rHasIn) {
          machineByEmpCode.set(empCode, r);
        }
      }
    }

    // Transform data for frontend
    const manualRecords = checkIns
      .filter((record) => record && record._id != null)
      .map((record) => {
        const checkInTime = parseCheckTime(record.checkInTime);
        const checkOutTime = parseCheckTime(record.checkOutTime);

        const employeeInfo = employeeByEmployeeId.get(record.employeeId) || {
          name: record.employeeId || 'Unknown',
          department: 'General',
          employeeId: record.employeeId || null,
          empCode: null,
        };

        const timeIn = timeHmFromDate(checkInTime);
        const timeOut = timeHmFromDate(checkOutTime);

        let status = 'absent';
        let isLate = false;
        if (timeIn) {
          status = 'present';
          isLate = isLateByPunchIn(checkInTime);
        }

        // IMPORTANT: In UI we display `biometricId` as Employee Code. Prefer emp_code if available.
        const biometricId = employeeInfo.empCode || employeeInfo.employeeId || record.employeeId;

        return {
          id: record._id.toString(),
          date: record.date,
          biometricId,
          employeeName: employeeInfo.name,
          department: employeeInfo.department,
          status,
          timeIn,
          timeOut,
          isLate,
          totalMinutes: record.totalMinutes || 0,
          source: 'manual',
        };
      });

    // Merge machine attendance onto manual records by emp_code (biometricId).
    const mergedByEmpCode = new Map(); // emp_code -> record
    for (const r of manualRecords) {
      const empCode = normalizeEmpCode(r.biometricId);
      if (empCode) mergedByEmpCode.set(empCode, r);
    }

    for (const [empCode, m] of machineByEmpCode.entries()) {
      const employeeInfo = employeeByEmpCode.get(empCode) || {
        name: m.name || 'Unknown',
        department: 'General',
        employeeId: null,
        empCode,
      };

      const mStatus = String(m.status || '').toLowerCase();
      // Treat MIS (missing punch-out, etc.) as present if punch_in exists.
      const hasPunchIn = m.punch_in != null && String(m.punch_in).trim() !== '';
      const isPresent = (mStatus === 'present' || mStatus === 'mis') && hasPunchIn;
      if (!isPresent) continue; // requirement: only auto-checkin when machine says Present

      const timeIn = m.punch_in ? String(m.punch_in).trim() : null;
      const timeOut = m.punch_out && String(m.punch_out).trim() !== '' ? String(m.punch_out).trim() : null;
      const checkInTime = timeHmToDate(date, timeIn);
      let isLate = false;
      if (checkInTime) isLate = isLateByPunchIn(checkInTime);

      const existing = mergedByEmpCode.get(empCode);
      if (existing) {
        const chosenTimeIn = minTimeHm(existing.timeIn, timeIn);
        const chosenTimeOut = maxTimeHm(existing.timeOut, timeOut);
        const chosenSource = chosenTimeIn === timeIn ? 'machine' : existing.source || 'manual';
        const chosenCheckInTime = timeHmToDate(date, chosenTimeIn);
        mergedByEmpCode.set(empCode, {
          ...existing,
          status: 'present',
          timeIn: chosenTimeIn,
          timeOut: chosenTimeOut,
          isLate: chosenCheckInTime ? isLateByPunchIn(chosenCheckInTime) : false,
          source: chosenSource,
        });
      } else {
        mergedByEmpCode.set(empCode, {
          id: `machine:${empCode}:${date}`,
          date,
          biometricId: empCode,
          employeeName: employeeInfo.name,
          department: employeeInfo.department,
          status: 'present',
          timeIn,
          timeOut,
          isLate,
          totalMinutes: 0,
          source: 'machine',
        });
      }
    }

    const attendanceRecords = Array.from(mergedByEmpCode.values()).sort((a, b) => {
      // show latest check-in first if available
      if (a.timeIn && b.timeIn) return a.timeIn < b.timeIn ? 1 : -1;
      if (a.timeIn) return -1;
      if (b.timeIn) return 1;
      return 0;
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
    const empCodeToCanonicalId = new Map(); // emp_code -> canonical employeeId
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

      const empCode = normalizeEmpCode(emp.emp_code);
      if (empCode && canonicalId) {
        empCodeToCanonicalId.set(empCode, canonicalId);
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

    // Add machine attendance "Present" as synthetic check-ins (so stats auto-update without manual button)
    try {
      const machineReports = await getMachineAttendanceForDay(date);
      const machinePresent = machineReports.filter((r) => {
        const st = String(r.status || '').toLowerCase();
        const hasIn = r.punch_in != null && String(r.punch_in).trim() !== '';
        return (st === 'present' || st === 'mis') && hasIn;
      });
      for (const r of machinePresent) {
        const empCode = normalizeEmpCode(r.emp_code);
        if (!empCode) continue;
        const canonicalId = empCodeToCanonicalId.get(empCode);
        if (!canonicalId) continue;

        const checkInTime = timeHmToDate(date, r.punch_in ? String(r.punch_in) : null);
        const checkOutTime = timeHmToDate(date, r.punch_out ? String(r.punch_out) : null);
        if (!checkInTime) continue;

        // Avoid duplicates if already checked-in manually
        const already = todayCheckIns.some((c) => {
          if (!c || !c.employeeId) return false;
          const normalized = employeeIdMap.get(c.employeeId) || c.employeeId;
          return normalized === canonicalId;
        });
        if (already) continue;

        todayCheckIns.push({
          employeeId: canonicalId,
          checkInTime,
          checkOutTime,
          date,
          source: 'machine',
        });
      }
    } catch (e) {
      console.warn('[attendance/stats] Machine attendance merge skipped:', e.message);
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
