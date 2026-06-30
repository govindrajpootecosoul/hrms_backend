const { getUsersCollection } = require('../../../config/mongo');
const { decryptAnnualCtcStored } = require('../../../utils/ctcEncryption');

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatValue(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function transformProfile(user) {
  if (!user) return null;

  const profile = {
    id: user._id?.toString() || '',
    name: user.name || '',
    email: user.email || '',
    role: user.role || '',
    employeeId: user.employeeId || '',
    department: user.department || '',
    company: user.company || '',
    active: user.isActive !== false,
    portals: Array.isArray(user.portals) ? user.portals : [],
    hasCredentialAccess: user.hasCredentialAccess !== false,
    hasSubscriptionAccess: user.hasSubscriptionAccess !== false,

    phone: user.phone || '',
    workPhone: user.workPhone || '',
    homePhone: user.homePhone || '',
    personalEmail: user.personalEmail || '',
    fatherName: user.fatherName || '',
    dateOfBirth: user.dateOfBirth || '',
    actualDob: user.actualDob || '',
    gender: user.gender || '',
    maritalStatus: user.maritalStatus || '',
    bloodGroup: user.bloodGroup || '',
    presentAddress: user.presentAddress || '',
    permanentAddress: user.permanentAddress || '',
    emergencyPhone: user.emergencyPhone || '',
    emergencyRelation: user.emergencyRelation || '',
    familyDetails: user.familyDetails || '',
    age: user.age || '',

    jobTitle: user.jobTitle || '',
    payrollCompany: user.payrollCompany || '',
    location: user.location || '',
    reportingManager: user.reportingManager || '',
    joiningDate: user.joiningDate || '',
    exitDate: user.exitDate || '',
    card_no: user.card_no || '',
    emp_code: user.emp_code || user.empCode || '',

    bankAccount: user.bankAccount || '',
    ifsc: user.ifsc || '',
    bankName: user.bankName || '',
    pan: user.pan || '',
    aadhaar: user.aadhaar || '',
    rationNumber: user.rationNumber || '',
    bankBranchName: user.bankBranchName || '',
    uan: user.uan || '',
    esiNo: user.esiNo || '',
    pfNo: user.pfNo || '',
    annualCtc: decryptAnnualCtcStored(user.annualCtc),
    pfRule: user.pfRule || '',
    pfSlabId: user.pfSlabId || '',

    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };

  const knownKeys = new Set(Object.keys(profile));
  const extras = {};
  for (const [key, raw] of Object.entries(user)) {
    if (['_id', 'password'].includes(key) || knownKeys.has(key)) continue;
    extras[key] = formatValue(raw);
  }

  return { profile, extras };
}

async function findEmployeeProfileDoc({ employeeId, email, company }) {
  const usersCol = await getUsersCollection(null, company);
  const queries = [];

  if (employeeId && company) {
    const employeeKey = String(employeeId).trim();
    queries.push(
      usersCol.findOne({
        company,
        $or: [
          { employeeId: employeeKey },
          { employeeId: new RegExp(`^${escapeRe(employeeKey)}$`, 'i') },
          { email: new RegExp(`^${escapeRe(employeeKey)}(@|$)`, 'i') },
        ],
      })
    );
  }

  if (email) {
    const emailKey = String(email).trim().toLowerCase();
    const emailQuery = { email: new RegExp(`^${escapeRe(emailKey)}$`, 'i') };
    if (company) emailQuery.company = company;
    queries.push(usersCol.findOne(emailQuery));
  }

  for (const promise of queries) {
    const doc = await promise;
    if (doc) return doc;
  }
  return null;
}

async function getEmployeeProfile({ employeeId, email, company }) {
  const doc = await findEmployeeProfileDoc({ employeeId, email, company });
  if (!doc) {
    const err = new Error('Employee profile not found');
    err.statusCode = 404;
    throw err;
  }
  return transformProfile(doc);
}

module.exports = { getEmployeeProfile, transformProfile };
