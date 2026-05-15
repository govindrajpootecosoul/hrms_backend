const { getCompanyFromRequest } = require('../utils/employeeContext');
const { listDepartmentTeam } = require('../services/departmentTeamService');

async function getDepartmentTeam(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) {
      return res.status(400).json({ success: false, error: 'company is required' });
    }
    const employeeId = req.query.employeeId;
    const userId = req.query.userId || null;
    const data = await listDepartmentTeam({ company, employeeId, userId });
    return res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400 || code === 404) {
      return res.status(code).json({ success: false, error: err.message });
    }
    console.error('[department-team] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getDepartmentTeam };
