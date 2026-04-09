const { connectMongo } = require('../../../config/mongo');
const { getCompanyFromRequest } = require('../utils/employeeContext');
const { submitRequest, listRequests } = require('../services/attendanceRequestsService');

async function submitAttendanceRequest(req, res) {
  try {
    await connectMongo();
    const { employeeId } = req.body || {};
    const company = getCompanyFromRequest(req);

    const data = await submitRequest({ employeeId, company, body: req.body });

    res.json({
      success: true,
      message: 'Attendance request submitted successfully',
      data,
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[attendance-request] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listAttendanceRequests(req, res) {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId;
    const company = getCompanyFromRequest(req);

    const data = await listRequests({ employeeId, company });

    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[attendance-requests] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { submitAttendanceRequest, listAttendanceRequests };