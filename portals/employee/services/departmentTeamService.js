const { getUsersCollection, getEmployeePortalDb } = require('../../../config/mongo');
const { getTodayStatus } = require('./checkinService');
const { getManagerScope } = require('./attendanceRequestsService');
const { checkinStatusCache, CHECKIN_STATUS_CACHE_TTL_MS } = require('../utils/employeeContext');
const { ATTENDANCE_REQUESTS } = require('../models');
const { parseDateRangeString } = require('../../../lib/leaveBalanceService');

function normalizeDept(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCheckInTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function isActiveEmployee(user) {
  if (!user) return false;
  if (user.isActive === false || user.active === false) return false;
  return true;
}

function isPresentToday(statusData) {
  if (!statusData) return false;
  if (statusData.status === 'checked-in') return true;
  const minutes = Number(statusData.totalMinutes || 0);
  if (minutes > 0) return true;
  return Boolean(statusData.checkInTime || statusData.earliestPunchInTime);
}

function todayYmdIst() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function isWfhLeaveType(leaveType) {
  const t = String(leaveType || '').trim().toLowerCase();
  return t === 'work from home' || t === 'wfh';
}

function dateInRange(ymd, range) {
  if (!ymd || !range?.start || !range?.end) return false;
  const day = new Date(`${ymd}T12:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return false;
  return day >= range.start && day <= range.end;
}

function resolveRequestRange(req) {
  return (
    parseDateRangeString(req.dateRange) ||
    parseDateRangeString(req.from && req.to ? `${req.from} - ${req.to}` : '') ||
    parseDateRangeString(req.from && req.to ? `${req.from} to ${req.to}` : '') ||
    (req.date ? parseDateRangeString(`${req.date} to ${req.date}`) : null)
  );
}

/**
 * Map employeeId (lowercase) → 'wfh' | 'leave' for approved requests covering today.
 * WFH wins if both somehow exist.
 */
async function loadApprovedLeaveWfhForToday({ company, employeeIds, todayYmd }) {
  const map = new Map();
  if (!employeeIds.length) return map;

  const db = await getEmployeePortalDb(company);
  const col = db.collection(ATTENDANCE_REQUESTS);
  const idSet = new Set(employeeIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean));

  const requests = await col
    .find({
      status: 'approved',
      $or: [
        { type: 'time-off' },
        { type: { $in: ['wfh', 'WFH', 'work-from-home', 'work from home'] } },
      ],
    })
    .project({ employeeId: 1, type: 1, leaveType: 1, dateRange: 1, from: 1, to: 1, date: 1 })
    .toArray();

  for (const req of requests) {
    const eid = String(req.employeeId || '').trim().toLowerCase();
    if (!eid || !idSet.has(eid)) continue;

    const range = resolveRequestRange(req);
    if (!dateInRange(todayYmd, range)) continue;

    const typeLower = String(req.type || '').trim().toLowerCase();
    const isWfh =
      isWfhLeaveType(req.leaveType) ||
      typeLower === 'wfh' ||
      typeLower === 'work-from-home' ||
      typeLower === 'work from home';

    const existing = map.get(eid);
    if (isWfh) {
      map.set(eid, 'wfh');
    } else if (existing !== 'wfh') {
      map.set(eid, 'leave');
    }
  }

  return map;
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
    { projection: { name: 1, employeeId: 1, email: 1, department: 1, isActive: 1, active: 1 } }
  );
}

async function listDepartmentTeam({ company, employeeId, userId }) {
  const normalizedCompany = String(company || '').trim();
  const normalizedEmployeeId = String(employeeId || '').trim();
  if (!normalizedCompany || !normalizedEmployeeId) {
    const err = new Error('company and employeeId are required');
    err.statusCode = 400;
    throw err;
  }

  const usersCol = await getUsersCollection(null, normalizedCompany);
  const self = await findEmployeeByEmployeeId(usersCol, normalizedCompany, normalizedEmployeeId);
  if (!self) {
    const err = new Error('Employee not found');
    err.statusCode = 404;
    throw err;
  }

  const deptKey = normalizeDept(self.department);
  if (!deptKey) {
    const managerScope = userId
      ? await getManagerScope({ userId, company: normalizedCompany })
      : { isManager: false, departments: [] };
    return {
      department: '',
      members: [],
      presentCount: 0,
      absentCount: 0,
      wfhCount: 0,
      leaveCount: 0,
      totalCount: 0,
      isManager: managerScope.isManager,
      summary: 'No department assigned',
    };
  }

  const colleagues = await usersCol
    .find({ company: normalizedCompany })
    .project({ name: 1, employeeId: 1, email: 1, department: 1, isActive: 1, active: 1 })
    .toArray();

  const team = colleagues
    .filter(isActiveEmployee)
    .filter((u) => normalizeDept(u.department) === deptKey)
    .filter((u) => String(u.employeeId || u.email || '').trim())
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const teamIds = team.map((u) => String(u.employeeId || '').trim() || String(u.email || '').trim());
  const todayYmd = todayYmdIst();
  let leaveWfhMap = new Map();
  try {
    leaveWfhMap = await loadApprovedLeaveWfhForToday({
      company: normalizedCompany,
      employeeIds: teamIds,
      todayYmd,
    });
  } catch {
    leaveWfhMap = new Map();
  }

  // Department team refreshes every 60s — use a longer TTL than single-user status polls.
  const cache = { map: checkinStatusCache, ttlMs: Math.max(CHECKIN_STATUS_CACHE_TTL_MS, 30000) };
  const members = await Promise.all(
    team.map(async (u) => {
      const eid = String(u.employeeId || '').trim() || String(u.email || '').trim();
      const leaveOrWfh = leaveWfhMap.get(eid.toLowerCase());

      // Approved leave / WFH takes priority over punch present/absent
      if (leaveOrWfh === 'wfh') {
        return {
          employeeId: eid,
          name: u.name || eid,
          isSelf: eid.toLowerCase() === normalizedEmployeeId.toLowerCase(),
          attendanceStatus: 'wfh',
          statusCode: 'WFH',
          checkInTime: null,
          checkInTimeIso: null,
        };
      }
      if (leaveOrWfh === 'leave') {
        return {
          employeeId: eid,
          name: u.name || eid,
          isSelf: eid.toLowerCase() === normalizedEmployeeId.toLowerCase(),
          attendanceStatus: 'on-leave',
          statusCode: 'L',
          checkInTime: null,
          checkInTimeIso: null,
        };
      }

      let statusData = null;
      try {
        statusData = await getTodayStatus({ employeeId: eid, company: normalizedCompany, cache });
      } catch {
        statusData = null;
      }
      const present = isPresentToday(statusData);
      const checkInIso = statusData?.earliestPunchInTime || statusData?.checkInTime || null;
      return {
        employeeId: eid,
        name: u.name || eid,
        isSelf: eid.toLowerCase() === normalizedEmployeeId.toLowerCase(),
        attendanceStatus: present ? 'present' : 'absent',
        statusCode: present ? 'P' : 'A',
        checkInTime: formatCheckInTime(checkInIso),
        checkInTimeIso: checkInIso,
      };
    })
  );

  const managerScope = userId
    ? await getManagerScope({ userId, company: normalizedCompany })
    : { isManager: false, departments: [] };

  const presentCount = members.filter((m) => m.attendanceStatus === 'present').length;
  const wfhCount = members.filter((m) => m.attendanceStatus === 'wfh').length;
  const leaveCount = members.filter((m) => m.attendanceStatus === 'on-leave').length;
  const absentCount = members.filter((m) => m.attendanceStatus === 'absent').length;

  const summaryParts = [];
  if (presentCount) summaryParts.push(`${presentCount} Present`);
  if (wfhCount) summaryParts.push(`${wfhCount} WFH`);
  if (leaveCount) summaryParts.push(`${leaveCount} Leave`);
  if (absentCount) summaryParts.push(`${absentCount} Absent`);

  return {
    department: String(self.department || '').trim(),
    members,
    presentCount,
    absentCount,
    wfhCount,
    leaveCount,
    totalCount: members.length,
    isManager: managerScope.isManager,
    summary: members.length
      ? summaryParts.join(' · ') || `${members.length} members`
      : 'No team members in your department',
  };
}

module.exports = { listDepartmentTeam };
