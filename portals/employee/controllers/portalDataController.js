const { getCompanyFromRequest } = require('../utils/employeeContext');
const { getOrCreateDoc } = require('../services/getOrCreateDoc');
const { defaultDashboard, defaultAttendance, defaultRequests, defaultOrg, defaultReports } = require('../services/defaults');
const { listOrgDirectory, mergeOrgWithDirectory } = require('../services/orgDirectoryService');
const { connectMongo, getEmployeePortalDb } = require('../../../config/mongo');
const {
  PORTAL_DASHBOARD,
  PORTAL_ATTENDANCE,
  PORTAL_REQUESTS,
  PORTAL_ORG,
  PORTAL_REPORTS,
} = require('../models');

const LEAVE_BALANCES_COLLECTION = 'leave_balances';
const DEFAULT_LEAVE_BALANCES = {
  'Casual Leave': 0,
  'Sick Leave': 0,
  'Earned Leave': 0,
  'Work From Home': 0,
  'Compensatory Off': 0,
  'Maternity Leave': 0,
  'LOP': 0,
};
const MATERNITY_DEFAULT_DAYS = 180;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePortalCompany(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lc = raw.toLowerCase();
  if (lc === '1' || lc === 'ecosoul' || lc === 'ecosoulhome' || lc === 'eco soul' || lc === 'ecosoul home') {
    return 'Ecosoul Home';
  }
  if (lc === '2' || lc === 'thrive' || lc === 'thrive brands' || lc === 'thrivebrands') return 'Thrive';
  return raw;
}

function buildLeaveCompanyClause(company) {
  const normalized = normalizePortalCompany(company);
  if (!normalized) return {};
  const lc = normalized.toLowerCase();
  if (lc === 'thrive') return { company: { $regex: /^thrive$/i } };
  if (lc.includes('ecosoul') || lc.includes('eco soul')) return { company: { $regex: /ecosoul/i } };
  return { company: normalized };
}

function isFemaleEmployee(gender) {
  return String(gender || '').trim().toLowerCase() === 'female';
}

function balanceHasMaternityKey(balances) {
  return balances != null && Object.prototype.hasOwnProperty.call(balances, 'Maternity Leave');
}

async function getEmployeeGenderForPortal(company, employeeId) {
  const empId = String(employeeId || '').trim();
  if (!company || !empId) return '';
  const { getUsersCollection } = require('../../../config/mongo');
  const usersCol = await getUsersCollection(null, company);
  const companyClause = buildLeaveCompanyClause(company);
  const emp = await usersCol.findOne(
    {
      ...companyClause,
      $or: [
        { employeeId: empId },
        { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
        { email: new RegExp(`^${escapeRe(empId)}@`, 'i') },
      ],
    },
    { projection: { gender: 1 } }
  );
  return emp?.gender || '';
}

function filterBalancesForGender(balances, gender, { maternitySeeded = false } = {}) {
  const b = { ...balances };
  if (isFemaleEmployee(gender)) {
    if (!maternitySeeded && !balanceHasMaternityKey(balances)) {
      b['Maternity Leave'] = MATERNITY_DEFAULT_DAYS;
    }
  } else {
    b['Maternity Leave'] = 0;
  }
  return b;
}

async function getLeaveBalancesForEmployee({ company, employeeId }) {
  if (!employeeId) {
    return { balances: { ...DEFAULT_LEAVE_BALANCES }, gender: '' };
  }
  await connectMongo();
  const db = await getEmployeePortalDb(company);
  const col = db.collection(LEAVE_BALANCES_COLLECTION);
  const empId = String(employeeId).trim();
  const companyClause = buildLeaveCompanyClause(company);

  let doc = await col.findOne(
    {
      ...companyClause,
      $or: [
        { employeeId: empId },
        { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
      ],
    },
    { projection: { balances: 1, employeeId: 1, company: 1 } }
  );

  const gender = company ? await getEmployeeGenderForPortal(company, empId) : '';
  let maternitySeeded = balanceHasMaternityKey(doc?.balances);

  // Persist default 180 maternity days for female employees once.
  if (isFemaleEmployee(gender) && !maternitySeeded) {
    const now = new Date();
    const companyName =
      (doc && doc.company) ||
      normalizePortalCompany(company) ||
      String(company || '').trim();
    await col.updateOne(
      {
        ...companyClause,
        $or: [
          { employeeId: empId },
          { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
        ],
      },
      {
        $set: {
          'balances.Maternity Leave': MATERNITY_DEFAULT_DAYS,
          updatedAt: now,
        },
        $setOnInsert: {
          company: companyName,
          employeeId: empId,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    maternitySeeded = true;
    doc = {
      ...(doc || {}),
      balances: {
        ...DEFAULT_LEAVE_BALANCES,
        ...(doc?.balances || {}),
        'Maternity Leave': MATERNITY_DEFAULT_DAYS,
      },
    };
  }

  const balances = filterBalancesForGender(
    { ...DEFAULT_LEAVE_BALANCES, ...(doc?.balances || {}) },
    gender,
    { maternitySeeded }
  );
  return { balances, gender };
}

function balancesToList(balances, gender) {
  const b = filterBalancesForGender(balances || {}, gender, {
    maternitySeeded: balanceHasMaternityKey(balances),
  });
  const list = [
    {
      type: 'Leave',
      balance: Number.isFinite(Number(b['Casual Leave'])) ? Number(b['Casual Leave']) : 0,
    },
    {
      type: 'Work From Home',
      balance: Number.isFinite(Number(b['Work From Home'])) ? Number(b['Work From Home']) : 0,
    },
  ];
  if (isFemaleEmployee(gender)) {
    list.push({
      type: 'Maternity Leave',
      balance: Number.isFinite(Number(b['Maternity Leave']))
        ? Number(b['Maternity Leave'])
        : MATERNITY_DEFAULT_DAYS,
    });
  }
  return list;
}

function totalLeaveBalance(balances) {
  const b = balances || {};
  const leave = Number(b['Casual Leave'] || 0);
  const wfh = Number(b['Work From Home'] || 0);
  return (Number.isFinite(leave) ? leave : 0) + (Number.isFinite(wfh) ? wfh : 0);
}

async function getDashboard(req, res) {
  try {
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_DASHBOARD, { employeeId }, defaultDashboard(employeeId), company);
    try {
      const { balances } = await getLeaveBalancesForEmployee({ company, employeeId });
      doc.quickStats = doc.quickStats || {};
      doc.quickStats.leaveBalance = totalLeaveBalance(balances);
    } catch {}
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getAttendance(req, res) {
  try {
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_ATTENDANCE, { employeeId }, defaultAttendance(employeeId), company);
    try {
      const { balances, gender } = await getLeaveBalancesForEmployee({ company, employeeId });
      doc.leaveBalance = totalLeaveBalance(balances);
      doc.leaveBalances = balancesToList(balances, gender);
    } catch {}
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getRequests(req, res) {
  try {
    const employeeId = req.query.employeeId || 'default';
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_REQUESTS, { employeeId }, defaultRequests(employeeId), company);
    try {
      const { balances, gender } = await getLeaveBalancesForEmployee({ company, employeeId });
      doc.leaveBalances = balancesToList(balances, gender);
    } catch {}
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Requests error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getOrg(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const employeeId = req.query.employeeId || null;
    const doc = await getOrCreateDoc(PORTAL_ORG, { key: 'org' }, defaultOrg(), company);

    let directory = { departments: [], myDepartmentName: '' };
    try {
      directory = await listOrgDirectory({ company, employeeId });
    } catch (err) {
      console.warn('[org] directory lookup failed:', err.message);
    }

    const departments = mergeOrgWithDirectory(doc, directory);
    return res.json({
      success: true,
      data: {
        ...doc,
        departments,
        myDepartmentName: directory.myDepartmentName || '',
      },
    });
  } catch (err) {
    console.error('Org error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getReports(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const doc = await getOrCreateDoc(PORTAL_REPORTS, { key: 'reports' }, defaultReports(), company);
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getDashboard, getAttendance, getRequests, getOrg, getReports };
