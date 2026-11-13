/**
 * Shared leave balance helpers: validate on submit, deduct on manager/HR approval.
 */
const { getUsersCollection } = require('../config/mongo');
const { getEmployeeDbForHrms, companyQuery } = require('../portals/hrms/utils/hrmsContext');

const LEAVE_BALANCES_COLLECTION = 'leave_balances';
const LEAVE_BALANCE_HISTORY_COLLECTION = 'leave_balance_history';

const DEFAULT_LEAVE_BALANCES = {
  'Casual Leave': 0,
  'Sick Leave': 0,
  'Earned Leave': 0,
  'Work From Home': 0,
  'Compensatory Off': 0,
  'Maternity Leave': 0,
  LOP: 0,
};

const BALANCE_LEAVE_TYPES = new Set(Object.keys(DEFAULT_LEAVE_BALANCES));

function safeInt(n, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.trunc(x);
}

/** Round to nearest 0.5 day for leave balances. */
function safeLeaveDays(n, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.round(x * 2) / 2;
}

function isSameCalendarDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function isWeekdayUtc(d) {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseYyyyMmDd(s) {
  if (!s) return null;
  const d = new Date(`${String(s).trim()}T00:00:00.000Z`);
  return isValidDate(d) ? d : null;
}

function parseDateRangeString(dateRange) {
  if (!dateRange) return null;
  const raw = String(dateRange).trim();
  const parts =
    raw.includes(' - ')
      ? raw.split(' - ')
      : raw.toLowerCase().includes(' to ')
        ? raw.split(/ to /i)
        : null;
  if (!parts || parts.length !== 2) return null;
  const start = parseYyyyMmDd(parts[0]);
  const end = parseYyyyMmDd(parts[1]);
  if (!start || !end) return null;
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  if (start > end) return null;
  return { start, end };
}

function countWeekdaysInclusive(fromDate, toDate) {
  let count = 0;
  const d = new Date(fromDate);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setUTCHours(0, 0, 0, 0);
  if (d.getTime() > end.getTime()) return 0;
  for (let x = new Date(d); x.getTime() <= end.getTime(); x.setUTCDate(x.getUTCDate() + 1)) {
    const wd = x.getUTCDay();
    if (wd !== 0 && wd !== 6) count += 1;
  }
  return count;
}

function normalizeLeaveTypeKey(leaveType) {
  const raw = String(leaveType || '').trim();
  if (!raw) return null;
  const map = new Map(Object.keys(DEFAULT_LEAVE_BALANCES).map((k) => [k.toLowerCase(), k]));
  const cleaned = raw.toLowerCase();
  if (map.has(cleaned)) return map.get(cleaned);
  if (cleaned === 'loss of pay') return 'LOP';
  if (cleaned === 'comp off' || cleaned === 'compoff') return 'Compensatory Off';
  if (cleaned === 'wfh' || cleaned === 'work from home') return 'Work From Home';
  if (cleaned === 'maternity leave' || cleaned === 'maternity') return 'Maternity Leave';
  if (cleaned === 'time off' || cleaned === 'leave') return 'Casual Leave';
  return raw;
}

function isFemaleEmployee(gender) {
  return String(gender || '').trim().toLowerCase() === 'female';
}

function isLopLeaveType(leaveKey) {
  return leaveKey === 'LOP';
}

async function getLeaveBalancesCol(company) {
  const db = await getEmployeeDbForHrms(company);
  return db.collection(LEAVE_BALANCES_COLLECTION);
}

async function getLeaveBalanceHistoryCol(company) {
  const db = await getEmployeeDbForHrms(company);
  return db.collection(LEAVE_BALANCE_HISTORY_COLLECTION);
}

async function getEmployeeGender(company, employeeId) {
  const usersCol = await getUsersCollection(null, company);
  const empId = String(employeeId || '').trim();
  if (!empId) return '';
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const emp = await usersCol.findOne(
    {
      ...companyQuery(company),
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

async function getCurrentBalance(company, employeeId, leaveKey) {
  const col = await getLeaveBalancesCol(company);
  const existing = await col.findOne({ company, employeeId }, { projection: { balances: 1 } });
  const balances = { ...DEFAULT_LEAVE_BALANCES, ...(existing?.balances || {}) };
  return safeLeaveDays(balances[leaveKey], 0);
}

async function applyBalanceDelta({ company, employeeId, leaveKey, delta, reason, performedBy }) {
  const col = await getLeaveBalancesCol(company);
  const historyCol = await getLeaveBalanceHistoryCol(company);

  const existing = await col.findOne({ company, employeeId }, { projection: { balances: 1 } });
  const prevBalances = { ...DEFAULT_LEAVE_BALANCES, ...(existing?.balances || {}) };
  const prevValue = safeLeaveDays(prevBalances[leaveKey], 0);
  const deltaRounded = safeLeaveDays(delta, 0);
  // Allow negative remaining (overdraft) when leave/WFH is approved after balance is exhausted.
  const nextValue = safeLeaveDays(prevValue + deltaRounded, 0);
  const appliedDelta = safeLeaveDays(nextValue - prevValue, 0);

  if (appliedDelta === 0) {
    return { changed: false, previous: prevValue, next: nextValue, delta: 0, leaveType: leaveKey };
  }

  const now = new Date();
  await col.updateOne(
    { company, employeeId },
    {
      $set: { updatedAt: now },
      $setOnInsert: { company, employeeId, createdAt: now },
      $inc: { [`balances.${leaveKey}`]: appliedDelta },
    },
    { upsert: true }
  );

  await historyCol.insertOne({
    company,
    employeeId,
    leaveType: leaveKey,
    delta: appliedDelta,
    previous: prevValue,
    next: nextValue,
    reason: typeof reason === 'string' ? reason.trim() : '',
    performedBy: typeof performedBy === 'string' ? performedBy.trim() : 'System',
    createdAt: now,
  });

  return { changed: true, previous: prevValue, next: nextValue, delta: appliedDelta, leaveType: leaveKey };
}

function resolveTimeOffDays(dateRange, { halfDay = false } = {}) {
  const range = parseDateRangeString(dateRange);
  if (!range) {
    return { ok: false, error: 'Invalid date range format. Use YYYY-MM-DD to YYYY-MM-DD.' };
  }

  if (halfDay) {
    if (!isSameCalendarDay(range.start, range.end)) {
      return { ok: false, error: 'Half-day leave must be for a single date (same from and to date).' };
    }
    if (!isWeekdayUtc(range.start)) {
      return { ok: false, error: 'Half-day leave can only be applied on a working day (Mon–Fri).' };
    }
    return { ok: true, days: 0.5, range, halfDay: true };
  }

  const days = countWeekdaysInclusive(range.start, range.end);
  if (days <= 0) {
    return { ok: false, error: 'Leave request must include at least one working day (Mon–Fri).' };
  }
  return { ok: true, days, range, halfDay: false };
}

async function validateTimeOffBalance({ company, employeeId, leaveType, dateRange, halfDay = false }) {
  const leaveKey = normalizeLeaveTypeKey(leaveType);
  if (!leaveKey) {
    return { ok: false, error: 'Leave type is required' };
  }

  const daysResult = resolveTimeOffDays(dateRange, { halfDay: Boolean(halfDay) });
  if (!daysResult.ok) return daysResult;

  if (isLopLeaveType(leaveKey)) {
    return { ok: true, days: daysResult.days, leaveKey, skipBalance: true, halfDay: Boolean(halfDay) };
  }

  if (!BALANCE_LEAVE_TYPES.has(leaveKey)) {
    return { ok: false, error: `Unsupported leave type: ${leaveType}` };
  }

  if (leaveKey === 'Maternity Leave') {
    const gender = await getEmployeeGender(company, employeeId);
    if (!isFemaleEmployee(gender)) {
      return { ok: false, error: 'Maternity Leave is only applicable for female employees' };
    }
  }

  const available = await getCurrentBalance(company, employeeId, leaveKey);
  // Allow apply/approve even when balance is 0 or already negative; approval will deduct into minus.
  return {
    ok: true,
    days: daysResult.days,
    leaveKey,
    available,
    skipBalance: false,
    halfDay: Boolean(halfDay),
    overdraft: available < daysResult.days,
  };
}

async function deductTimeOffOnApproval({ company, request, performedBy, approverRole }) {
  if (!request || request.type !== 'time-off') {
    return { ok: true, skipped: true, reason: 'not_time_off' };
  }

  if (request.leaveDaysDeducted != null && Number(request.leaveDaysDeducted) > 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_deducted',
      days: Number(request.leaveDaysDeducted),
      leaveKey: request.leaveBalanceKey || null,
    };
  }

  const employeeId = String(request.employeeId || '').trim();
  const leaveType = request.leaveType || 'Casual Leave';
  const dateRange = request.dateRange;
  const requestId = request._id ? String(request._id) : '';

  const historyCol = await getLeaveBalanceHistoryCol(company);
  const priorDeduction = await historyCol.findOne({
    company,
    employeeId,
    reason: { $regex: `request ${requestId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
  });
  if (priorDeduction) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_deducted_history',
      days: Math.abs(safeLeaveDays(priorDeduction.delta, 0)),
      leaveKey: priorDeduction.leaveType || null,
    };
  }

  const validation = await validateTimeOffBalance({
    company,
    employeeId,
    leaveType,
    dateRange,
    halfDay: Boolean(request.halfDay),
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  if (validation.skipBalance) {
    return {
      ok: true,
      skipped: true,
      days: validation.days,
      leaveKey: validation.leaveKey,
      lop: true,
    };
  }

  const roleLabel = approverRole === 'manager' ? 'Manager' : 'HR';
  const halfLabel = validation.halfDay ? ' (half day)' : '';
  const reason = `Leave approved (${roleLabel})${halfLabel}: ${dateRange} — request ${requestId}`;

  const result = await applyBalanceDelta({
    company,
    employeeId,
    leaveKey: validation.leaveKey,
    delta: -validation.days,
    reason,
    performedBy: performedBy || roleLabel,
  });

  if (!result.changed && validation.days > 0) {
    return {
      ok: false,
      error: `Could not deduct ${validation.days} day(s) from ${validation.leaveKey}.`,
    };
  }

  return {
    ok: true,
    days: validation.days,
    leaveKey: validation.leaveKey,
    previous: result.previous,
    next: result.next,
    delta: result.delta,
    overdraft: Number(result.next) < 0,
  };
}

module.exports = {
  parseDateRangeString,
  countWeekdaysInclusive,
  normalizeLeaveTypeKey,
  validateTimeOffBalance,
  deductTimeOffOnApproval,
  applyBalanceDelta,
  getCurrentBalance,
};
