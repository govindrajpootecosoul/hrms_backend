const { getDb, getEmployeePortalDb } = require('../../../config/mongo');
const { ATTENDANCE_REQUESTS } = require('../models');
const { emitAttendanceChanged } = require('../../../lib/attendanceEvents');

async function getRequestsCollection(company) {
  const db = company ? await getEmployeePortalDb(company) : await getDb();
  return db.collection(ATTENDANCE_REQUESTS);
}

function validateType(type) {
  const validTypes = ['regularization', 'on-duty', 'time-off'];
  if (!validTypes.includes(type)) {
    const err = new Error('Invalid request type. Must be: regularization, on-duty, or time-off');
    err.statusCode = 400;
    throw err;
  }
}

function validateFields(type, body) {
  const { date, timeWindow, location, dateRange, reason } = body;
  if (type === 'regularization' && (!date || !timeWindow)) {
    const err = new Error('Date and time window are required for regularization');
    err.statusCode = 400;
    throw err;
  }
  if (type === 'on-duty' && (!date || !location)) {
    const err = new Error('Date and location are required for on-duty request');
    err.statusCode = 400;
    throw err;
  }
  if (type === 'time-off' && (!dateRange || !reason)) {
    const err = new Error('Date range and reason are required for time-off request');
    err.statusCode = 400;
    throw err;
  }
}

async function submitRequest({ employeeId, company, body }) {
  const { type } = body || {};

  if (!employeeId || !type) {
    const err = new Error('Employee ID and request type are required');
    err.statusCode = 400;
    throw err;
  }

  validateType(type);
  validateFields(type, body);

  const col = await getRequestsCollection(company);

  const { date, timeWindow, notes, location, details, dateRange, reason, leaveType } = body;

  const requestDoc = {
    employeeId,
    type,
    status: 'pending',
    submittedAt: new Date(),
    company: company || null,
    ...(type === 'regularization' && { date, timeWindow, notes: notes || '' }),
    ...(type === 'on-duty' && { date, location, details: details || '' }),
    ...(type === 'time-off' && {
      dateRange,
      reason: reason || '',
      leaveType: leaveType || 'Time Off',
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await col.insertOne(requestDoc);
  // Attendance requests can affect dashboard stats once approved (and are visible in pending counts).
  emitAttendanceChanged({ company, type: 'attendance_request_submitted', date: (date || new Date().toISOString().slice(0, 10)) });
  return { requestId: result.insertedId, type, status: 'pending' };
}

async function listRequests({ employeeId, company }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getRequestsCollection(company);
  const requests = await col.find({ employeeId }).sort({ submittedAt: -1 }).toArray();

  return {
    requests: requests.map((req) => ({
      id: req._id,
      type: req.type,
      status: req.status,
      leaveType: req.leaveType,
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
      updatedAt: req.updatedAt,
    })),
  };
}

module.exports = { submitRequest, listRequests };