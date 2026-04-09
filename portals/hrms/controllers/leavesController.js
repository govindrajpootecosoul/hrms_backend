/**
 * Leave listing, leave overview stats, and attendance-requests (HR approval workflow).
 */
const { connectMongo } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');

async function listLeaves(req, res) {
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
}

async function listAttendanceRequests(req, res) {
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
}

async function leaveOverviewStats(req, res) {
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
}

async function leaveUtilization(req, res) {
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
    const { getUsersCollection } = require('../../../config/mongo');
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
}

async function attendanceRequestStats(req, res) {
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
}

async function approveAttendanceRequest(req, res) {
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
}

async function rejectAttendanceRequest(req, res) {
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
}

async function updateAttendanceRequest(req, res) {
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
}

async function deleteAttendanceRequest(req, res) {
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
}

async function createAttendanceRequest(req, res) {
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
}

module.exports = {
  listLeaves,
  listAttendanceRequests,
  leaveOverviewStats,
  leaveUtilization,
  attendanceRequestStats,
  approveAttendanceRequest,
  rejectAttendanceRequest,
  updateAttendanceRequest,
  deleteAttendanceRequest,
  createAttendanceRequest,
};
