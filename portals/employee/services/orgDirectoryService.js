const { getUsersCollection } = require('../../../config/mongo');

function normalizeDept(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(value) {
  return String(value || 'department')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'department';
}

function deptNamesMatch(a, b) {
  const left = normalizeDept(a);
  const right = normalizeDept(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function isActiveEmployee(user) {
  if (!user) return false;
  if (user.isActive === false || user.active === false) return false;
  return true;
}

async function findEmployeeByEmployeeId(usersCol, company, employeeId) {
  const employeeKey = String(employeeId || '').trim();
  if (!employeeKey) return null;
  return usersCol.findOne(
    {
      company,
      $or: [
        { employeeId: employeeKey },
        { employeeId: new RegExp(`^${escapeRe(employeeKey)}$`, 'i') },
        { email: new RegExp(`^${escapeRe(employeeKey)}(@|$)`, 'i') },
      ],
    },
    { projection: { name: 1, employeeId: 1, email: 1, department: 1, designation: 1, isActive: 1, active: 1 } }
  );
}

async function listOrgDirectory({ company, employeeId }) {
  const normalizedCompany = String(company || '').trim();
  if (!normalizedCompany) {
    const err = new Error('company is required');
    err.statusCode = 400;
    throw err;
  }

  const usersCol = await getUsersCollection(null, normalizedCompany);
  const users = await usersCol
    .find({ company: normalizedCompany })
    .project({
      name: 1,
      employeeId: 1,
      email: 1,
      department: 1,
      designation: 1,
      isActive: 1,
      active: 1,
    })
    .toArray();

  const byDept = new Map();
  for (const user of users.filter(isActiveEmployee)) {
    const deptName = String(user.department || '').trim() || 'Unassigned';
    const key = normalizeDept(deptName);
    if (!byDept.has(key)) {
      byDept.set(key, { name: deptName, employees: [] });
    }
    const eid = String(user.employeeId || '').trim() || String(user.email || '').trim();
    if (!eid) continue;
    byDept.get(key).employees.push({
      employeeId: eid,
      name: String(user.name || eid).trim(),
      email: user.email || '',
      designation: user.designation || '',
    });
  }

  const departments = Array.from(byDept.values())
    .map((dept) => ({
      name: dept.name,
      id: slugify(dept.name),
      headcount: dept.employees.length,
      employees: dept.employees.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  let myDepartmentName = '';
  if (employeeId) {
    const self = await findEmployeeByEmployeeId(usersCol, normalizedCompany, employeeId);
    myDepartmentName = String(self?.department || '').trim();
  }

  return { departments, myDepartmentName };
}

function mergeOrgWithDirectory(staticOrg, directory) {
  const staticDepts = Array.isArray(staticOrg?.departments) ? staticOrg.departments : [];
  const liveDepts = Array.isArray(directory?.departments) ? directory.departments : [];
  const usedLive = new Set();

  const merged = staticDepts.map((staticDept) => {
    const liveMatch = liveDepts.find((liveDept) => deptNamesMatch(staticDept.name, liveDept.name));
    if (liveMatch) usedLive.add(liveMatch.id);
    const employees = liveMatch?.employees || [];
    return {
      ...staticDept,
      headcount: employees.length || staticDept.headcount || 0,
      employees,
      liveDepartmentName: liveMatch?.name || staticDept.name,
    };
  });

  for (const liveDept of liveDepts) {
    if (usedLive.has(liveDept.id)) continue;
    merged.push({
      id: liveDept.id,
      name: liveDept.name,
      description: '',
      headcount: liveDept.headcount,
      employees: liveDept.employees,
      liveDepartmentName: liveDept.name,
    });
  }

  merged.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return merged;
}

module.exports = {
  listOrgDirectory,
  mergeOrgWithDirectory,
  deptNamesMatch,
};
