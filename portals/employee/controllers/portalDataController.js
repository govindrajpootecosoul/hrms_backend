const { connectMongo } = require('../../../config/mongo');
const { getCompanyFromRequest } = require('../utils/employeeContext');
const { getOrCreateDoc } = require('../services/getOrCreateDoc');
const { defaultDashboard, defaultAttendance, defaultRequests, defaultOrg, defaultReports } = require('../services/defaults');
const {
  PORTAL_DASHBOARD,
  PORTAL_ATTENDANCE,
  PORTAL_REQUESTS,
  PORTAL_ORG,
  PORTAL_REPORTS,
} = require('../models');

async function getDashboard(req, res) {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    const doc = await getOrCreateDoc(PORTAL_DASHBOARD, { employeeId }, defaultDashboard(employeeId), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getAttendance(req, res) {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    const doc = await getOrCreateDoc(PORTAL_ATTENDANCE, { employeeId }, defaultAttendance(employeeId), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getRequests(req, res) {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    const doc = await getOrCreateDoc(PORTAL_REQUESTS, { employeeId }, defaultRequests(employeeId), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Requests error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getOrg(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const doc = await getOrCreateDoc(PORTAL_ORG, { key: 'org' }, defaultOrg(), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Org error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getReports(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const doc = await getOrCreateDoc(PORTAL_REPORTS, { key: 'reports' }, defaultReports(), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getDashboard, getAttendance, getRequests, getOrg, getReports };