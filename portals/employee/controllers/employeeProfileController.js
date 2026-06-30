const { getCompanyFromRequest } = require('../utils/employeeContext');
const { getEmployeeProfile } = require('../services/employeeProfileService');

async function getProfile(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    const employeeId = req.query.employeeId ? String(req.query.employeeId).trim() : '';
    const email = req.query.email ? String(req.query.email).trim() : '';

    if (!employeeId && !email) {
      return res.status(400).json({ success: false, error: 'employeeId or email is required' });
    }

    const data = await getEmployeeProfile({ employeeId, email, company });
    return res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 404) {
      return res.status(404).json({ success: false, error: err.message });
    }
    console.error('[employee/profile] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getProfile };
