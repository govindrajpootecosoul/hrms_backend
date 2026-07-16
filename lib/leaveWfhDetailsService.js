/**
 * Leaves & WFH Details tracker.
 *
 * Same company DB + same sources as Leave Balance tab:
 * - Remaining: `leave_balances` (Casual Leave + Work From Home)
 * - Day-wise / monthly taken: approved `attendance_requests` (type time-off)
 * - Optional HR overrides: `leave_wfh_day_entries`
 * - Manual edits adjust `leave_balances` + `leave_balance_history` (same as Leave Balance)
 */
const { getUsersCollection } = require('../config/mongo');
const {
  getEmployeeDbForHrms,
  companyQuery,
} = require('../portals/hrms/utils/hrmsContext');
const {
  parseDateRangeString,
  normalizeLeaveTypeKey,
  applyBalanceDelta,
} = require('./leaveBalanceService');
const {
  normalizeEmpCode,
  getUtcMonthRange,
  getMachineAttendanceForRange,
  extractYyyyMmDdFromMachineDate,
  isMachinePresentRecord,
} = require('../portals/hrms/utils/machineAttendanceQuery');

const DAY_ENTRIES_COLLECTION = 'leave_wfh_day_entries';
const ATTENDANCE_REQUESTS_COLLECTION = 'attendance_requests';
const LEAVE_BALANCES_COLLECTION = 'leave_balances';
const CHECKINS_COLLECTION = 'employee_checkins';

/** Same leave types managed on Leave Balance tab */
const BALANCE_LEAVE_KEY = 'Casual Leave';
const BALANCE_WFH_KEY = 'Work From Home';

const DAY_CODES = ['L', 'WFH', 'HD', 'SL', 'HDWFH'];

const CODE_META = {
  L: { leaveType: BALANCE_LEAVE_KEY, days: 1, category: 'leave', label: 'Leave' },
  HD: { leaveType: BALANCE_LEAVE_KEY, days: 0.5, category: 'leave', label: 'Half Day' },
  SL: { leaveType: 'Sick Leave', days: 1, category: 'leave', label: 'Sick Leave' },
  WFH: { leaveType: BALANCE_WFH_KEY, days: 1, category: 'wfh', label: 'Work From Home' },
  HDWFH: { leaveType: BALANCE_WFH_KEY, days: 0.5, category: 'wfh', label: 'Half Day WFH' },
};

const DEFAULT_BALANCES = {
  'Casual Leave': 0,
  'Sick Leave': 0,
  'Earned Leave': 0,
  'Work From Home': 0,
  'Compensatory Off': 0,
  'Maternity Leave': 0,
  LOP: 0,
};

function safeLeaveDays(n, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.round(x * 2) / 2;
}

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s).trim())) return null;
  const d = new Date(`${String(s).trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isWeekendUtc(d) {
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

function normId(value) {
  return String(value || '').trim().toUpperCase();
}

function requestToCode(leaveType, halfDay) {
  const raw = String(leaveType || '').trim();
  const lower = raw.toLowerCase();
  const half = Boolean(halfDay);

  // Explicit UI labels stored on attendance_requests (canonicalLeaveTypeLabel → "Leave")
  if (lower === 'work from home' || lower === 'wfh') {
    return half ? 'HDWFH' : 'WFH';
  }
  if (lower === 'leave' || lower === 'casual leave' || lower === 'time off') {
    return half ? 'HD' : 'L';
  }
  if (lower === 'sick leave' || lower === 'sl') {
    return half ? 'HD' : 'SL';
  }

  const key = normalizeLeaveTypeKey(leaveType) || BALANCE_LEAVE_KEY;
  if (key === BALANCE_WFH_KEY) return half ? 'HDWFH' : 'WFH';
  if (key === 'Sick Leave') return half ? 'HD' : 'SL';
  // Casual / Earned / Comp Off / Maternity / LOP / generic → L or HD
  return half ? 'HD' : 'L';
}

function emptyMonthTotals() {
  return { leave: 0, wfh: 0 };
}

function emptyDaySummary() {
  return { L: 0, HD: 0, SL: 0, WFH: 0, HDWFH: 0, totalLeaves: 0, totalWfh: 0, present: 0, absent: 0 };
}

function addCodeToSummary(summary, code) {
  const meta = CODE_META[code];
  if (!meta) return;
  summary[code] = safeLeaveDays((summary[code] || 0) + meta.days);
  if (meta.category === 'leave') {
    summary.totalLeaves = safeLeaveDays(summary.totalLeaves + meta.days);
  } else {
    summary.totalWfh = safeLeaveDays(summary.totalWfh + meta.days);
  }
}

/** Calendar today in Asia/Kolkata as YYYY-MM-DD */
function todayYmdIst() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return ymd(new Date());
  }
}

/**
 * Day cell priority (weekdays):
 * 1) approved leave / WFH → L / WFH / …
 * 2) else biometric or manual check-in → P
 * 3) else past/today → A ; future with no leave → -
 * Weekend → blank
 */
function resolveDayDisplay({ date, isWeekend, leaveCode, hasPresent, today }) {
  if (isWeekend) {
    return { code: null, display: '', status: 'weekend', editable: false };
  }
  // Approved leave/WFH always wins (including future approved days)
  if (leaveCode && CODE_META[leaveCode]) {
    return { code: leaveCode, display: leaveCode, status: 'leave', editable: true };
  }
  if (date > today) {
    return { code: null, display: '-', status: 'future', editable: false };
  }
  if (hasPresent) {
    return { code: 'P', display: 'P', status: 'present', editable: true };
  }
  return { code: 'A', display: 'A', status: 'absent', editable: true };
}

/**
 * Present keys: `${canonicalEmployeeId}|YYYY-MM-DD`
 * from manual employee_checkins + machine_attendance_reports (Present/MIS + punch_in).
 */
async function buildPresentKeySet({ company, year, month, employees, aliasToCanonical }) {
  const present = new Set();
  const range = getUtcMonthRange(`${year}-${String(month).padStart(2, '0')}`);
  if (!range) return present;

  const empIds = [];
  const seenIds = new Set();
  for (const emp of employees) {
    for (const id of [emp.employeeId, ...(emp.aliases || [])]) {
      const s = String(id || '').trim();
      if (!s || seenIds.has(s)) continue;
      seenIds.add(s);
      empIds.push(s);
    }
  }

  // emp_code → canonical employeeId
  const codeToCanonical = new Map();
  for (const emp of employees) {
    const canonical = normId(emp.employeeId);
    const code = normalizeEmpCode(emp.employeeCode);
    if (code) codeToCanonical.set(normId(code), canonical);
    for (const a of emp.aliases || []) {
      const ac = normalizeEmpCode(a);
      if (ac) codeToCanonical.set(normId(ac), canonical);
    }
  }

  // Manual portal check-ins (company DB)
  try {
    const db = await getEmployeeDbForHrms(company);
    const checkins = await db
      .collection(CHECKINS_COLLECTION)
      .find({
        date: { $gte: range.startDate, $lte: range.endDate },
        employeeId: { $in: empIds },
      })
      .project({ employeeId: 1, date: 1, checkInTime: 1, empCode: 1 })
      .toArray();

    for (const c of checkins) {
      const hasIn = c.checkInTime != null && String(c.checkInTime).trim() !== '';
      if (!hasIn) continue;
      const dateKey = String(c.date || '').slice(0, 10);
      if (!dateKey) continue;
      const raw = normId(c.employeeId);
      const canonical = (aliasToCanonical && aliasToCanonical.get(raw)) || raw;
      if (!canonical) continue;
      present.add(`${canonical}|${dateKey}`);
      const code = normalizeEmpCode(c.empCode);
      if (code) {
        const viaCode = codeToCanonical.get(normId(code));
        if (viaCode) present.add(`${viaCode}|${dateKey}`);
      }
    }
  } catch (e) {
    console.warn('[leaveWfhDetails] employee_checkins load failed:', e.message);
  }

  // Biometric machine attendance (main_db)
  try {
    const machineRows = await getMachineAttendanceForRange(range);
    for (const r of machineRows) {
      if (!isMachinePresentRecord(r)) continue;
      const dateKey = extractYyyyMmDdFromMachineDate(r.date);
      if (!dateKey || dateKey < range.startDate || dateKey > range.endDate) continue;
      const code = normalizeEmpCode(r.emp_code);
      if (!code) continue;
      const canonical = codeToCanonical.get(normId(code));
      if (!canonical) continue;
      present.add(`${canonical}|${dateKey}`);
    }
  } catch (e) {
    console.warn('[leaveWfhDetails] machine_attendance load failed:', e.message);
  }

  return present;
}

function employeeIsPresentOn(presentSet, employeeId, date, aliasToCanonical) {
  const raw = normId(employeeId);
  const canonical = (aliasToCanonical && aliasToCanonical.get(raw)) || raw;
  return presentSet.has(`${canonical}|${date}`);
}

function resolveRequestRange(req) {
  return (
    parseDateRangeString(req.dateRange) ||
    parseDateRangeString(req.from && req.to ? `${req.from} - ${req.to}` : '') ||
    parseDateRangeString(req.from && req.to ? `${req.from} to ${req.to}` : '')
  );
}

async function getEmployees(company) {
  const usersCol = await getUsersCollection(null, company);
  const cq = companyQuery(company);
  const employees = await usersCol
    .find(cq)
    .project({
      employeeId: 1,
      email: 1,
      name: 1,
      firstName: 1,
      emp_code: 1,
      biometricId: 1,
      joiningDate: 1,
      createdAt: 1,
      status: 1,
      isActive: 1,
      active: 1,
    })
    .toArray();

  return employees
    .map((emp) => {
      const email = String(emp.email || '').trim();
      const emailPrefix = email.includes('@') ? email.split('@')[0].trim() : '';
      const employeeId = String(emp.employeeId || emailPrefix || '').trim();
      if (!employeeId) return null;
      // Same as Employees screen / admin-users: isActive true (or unset) = current; false = ex
      const isActive = emp.isActive !== false && emp.active !== false;
      const isExited = !isActive;
      return {
        employeeId,
        email,
        emailPrefix,
        employeeCode: String(emp.emp_code || emp.biometricId || employeeId).trim(),
        employeeName: emp.name || emp.firstName || employeeId,
        joiningDate: emp.joiningDate || emp.createdAt || null,
        isActive,
        status: isActive ? 'Active' : 'Inactive',
        isExited,
        aliases: [employeeId, emp.emp_code, emp.biometricId, email, emailPrefix]
          .map((x) => String(x || '').trim())
          .filter(Boolean),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** Build alias → canonical employeeId (uppercase) for matching requests ↔ employees */
function buildAliasIndex(employees) {
  const aliasToCanonical = new Map();
  for (const emp of employees) {
    const canonical = normId(emp.employeeId);
    for (const a of emp.aliases || [emp.employeeId]) {
      const key = normId(a);
      if (key) aliasToCanonical.set(key, canonical);
    }
  }
  return aliasToCanonical;
}

/**
 * Same collection as Leave Balance tab (`leave_balances`).
 * Indexes by employeeId + uppercase for join.
 */
async function getBalancesMap(company) {
  const db = await getEmployeeDbForHrms(company);
  const rows = await db
    .collection(LEAVE_BALANCES_COLLECTION)
    .find(companyQuery(company))
    .toArray();
  const map = new Map();
  rows.forEach((r) => {
    const id = String(r.employeeId || '').trim();
    if (!id) return;
    const balances = { ...DEFAULT_BALANCES, ...(r.balances || {}) };
    map.set(id, balances);
    map.set(normId(id), balances);
    if (id.includes('@')) {
      const prefix = id.split('@')[0].trim();
      if (prefix) {
        map.set(prefix, balances);
        map.set(normId(prefix), balances);
      }
    }
  });
  return map;
}

function getBalance(map, employeeId, aliases = []) {
  const candidates = [employeeId, ...aliases].map((x) => String(x || '').trim()).filter(Boolean);
  for (const c of candidates) {
    const hit = map.get(c) || map.get(normId(c));
    if (hit) return hit;
  }
  return { ...DEFAULT_BALANCES };
}

/**
 * Approved leave/WFH already taken by employees.
 * Queried from company DB `attendance_requests` (type time-off, status approved).
 * Company DB is already tenant-scoped; company field filter is soft so older docs still match.
 */
async function getApprovedTimeOff(company, year) {
  const db = await getEmployeeDbForHrms(company);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const cq = companyQuery(company);

  const rows = await db
    .collection(ATTENDANCE_REQUESTS_COLLECTION)
    .find({
      type: { $regex: /^time[-_]?off$/i },
      status: { $regex: /^approved$/i },
      $and: [
        {
          $or: [
            cq,
            { company: { $exists: false } },
            { company: null },
            { company: '' },
          ],
        },
        {
          $or: [
            { dateRange: { $exists: true, $nin: [null, ''] } },
            {
              $and: [
                { from: { $exists: true, $nin: [null, ''] } },
                { to: { $exists: true, $nin: [null, ''] } },
              ],
            },
          ],
        },
      ],
    })
    .project({
      employeeId: 1,
      leaveType: 1,
      halfDay: 1,
      dateRange: 1,
      from: 1,
      to: 1,
      leaveDaysDeducted: 1,
    })
    .toArray();

  return rows.filter((r) => {
    const range = resolveRequestRange(r);
    if (!range) return false;
    const startYmd = ymd(range.start);
    const endYmd = ymd(range.end);
    return endYmd >= yearStart && startYmd <= yearEnd;
  });
}

async function getManualDayEntries(company, year, month = null) {
  const db = await getEmployeeDbForHrms(company);
  const prefix =
    month != null ? `${year}-${String(month).padStart(2, '0')}` : String(year);
  return db
    .collection(DAY_ENTRIES_COLLECTION)
    .find({
      ...companyQuery(company),
      date: { $regex: `^${prefix}` },
    })
    .toArray();
}

/**
 * Build canonicalEmployeeId(upper) -> date -> cell
 * Fills from approved requests (taken leave/WFH), then manual overrides.
 */
function buildDayMaps({ requests, manualEntries, year, aliasToCanonical }) {
  const byEmployee = new Map();

  const ensure = (employeeId) => {
    const raw = normId(employeeId);
    if (!raw) return null;
    const id = (aliasToCanonical && aliasToCanonical.get(raw)) || raw;
    if (!byEmployee.has(id)) byEmployee.set(id, new Map());
    return byEmployee.get(id);
  };

  for (const req of requests) {
    const dayMap = ensure(req.employeeId);
    if (!dayMap) continue;
    const range = resolveRequestRange(req);
    if (!range) continue;

    const halfDay =
      Boolean(req.halfDay) ||
      Number(req.leaveDaysDeducted) === 0.5;
    const code = requestToCode(req.leaveType, halfDay);
    const meta = CODE_META[code];
    if (!meta) continue;

    const end = new Date(range.end);
    end.setUTCHours(0, 0, 0, 0);

    for (
      let d = new Date(range.start);
      d.getTime() <= end.getTime();
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      d.setUTCHours(0, 0, 0, 0);
      if (d.getUTCFullYear() !== year) continue;
      if (isWeekendUtc(d)) continue;
      const key = ymd(d);
      // Half-day requests only occupy the single day; already ensured by range.
      // Prefer WFH over Leave if both somehow exist; otherwise first wins, manual overlays later.
      const existing = dayMap.get(key);
      if (existing && existing.code) {
        const existingMeta = CODE_META[existing.code];
        if (existingMeta?.category === 'wfh' && meta.category === 'leave') continue;
        if (existingMeta?.category === meta.category) continue;
      }
      dayMap.set(key, {
        code,
        source: 'request',
        days: meta.days,
        leaveType: meta.leaveType,
      });
    }
  }

  for (const entry of manualEntries) {
    const dayMap = ensure(entry.employeeId);
    if (!dayMap) continue;
    const key = String(entry.date || '').trim();
    if (!key) continue;
    if (entry.cleared || !entry.code) {
      dayMap.set(key, { code: null, source: 'manual', cleared: true, days: 0 });
      continue;
    }
    if (!CODE_META[entry.code]) continue;
    dayMap.set(key, {
      code: entry.code,
      source: 'manual',
      days: CODE_META[entry.code].days,
      leaveType: CODE_META[entry.code].leaveType,
    });
  }

  return byEmployee;
}

function getEmployeeDayMap(byEmployee, employeeId, aliasToCanonical) {
  const raw = normId(employeeId);
  const id = (aliasToCanonical && aliasToCanonical.get(raw)) || raw;
  return byEmployee.get(id) || new Map();
}

async function getYearlySummary({ company, year }) {
  const [employees, balancesMap, requests, manualEntries] = await Promise.all([
    getEmployees(company),
    getBalancesMap(company),
    getApprovedTimeOff(company, year),
    getManualDayEntries(company, year),
  ]);

  const aliasToCanonical = buildAliasIndex(employees);
  const dayMaps = buildDayMaps({ requests, manualEntries, year, aliasToCanonical });
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const rows = employees.map((emp, idx) => {
    const dayMap = getEmployeeDayMap(dayMaps, emp.employeeId, aliasToCanonical);
    const monthly = {};
    let grandLeave = 0;
    let grandWfh = 0;

    for (const m of months) {
      const totals = emptyMonthTotals();
      const prefix = `${year}-${String(m).padStart(2, '0')}`;
      for (const [dateKey, cell] of dayMap.entries()) {
        if (!dateKey.startsWith(prefix) || !cell?.code) continue;
        const meta = CODE_META[cell.code];
        if (!meta) continue;
        if (meta.category === 'leave') totals.leave = safeLeaveDays(totals.leave + meta.days);
        else totals.wfh = safeLeaveDays(totals.wfh + meta.days);
      }
      monthly[m] = totals;
      grandLeave = safeLeaveDays(grandLeave + totals.leave);
      grandWfh = safeLeaveDays(grandWfh + totals.wfh);
    }

    const bal = getBalance(balancesMap, emp.employeeId, emp.aliases);

    return {
      sno: idx + 1,
      employeeId: emp.employeeId,
      employeeCode: emp.employeeCode,
      employeeName: emp.employeeName,
      joiningDate: emp.joiningDate,
      isActive: emp.isActive,
      status: emp.status,
      isExited: emp.isExited,
      monthly,
      // Taken in this year (from approved leave/WFH requests + manual)
      grandTotalLeaves: grandLeave,
      grandTotalWfh: grandWfh,
      // Same remaining as Leave Balance tab
      balanceLeaves: safeLeaveDays(bal[BALANCE_LEAVE_KEY], 0),
      balanceWfh: safeLeaveDays(bal[BALANCE_WFH_KEY], 0),
    };
  });

  return {
    year,
    months,
    dayCodes: DAY_CODES,
    sources: {
      balances: LEAVE_BALANCES_COLLECTION,
      taken: ATTENDANCE_REQUESTS_COLLECTION,
      overrides: DAY_ENTRIES_COLLECTION,
      leaveTypes: [BALANCE_LEAVE_KEY, BALANCE_WFH_KEY],
    },
    rows,
  };
}

function buildMonthDays(year, month) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = new Date(Date.UTC(year, month - 1, d));
    days.push({
      day: d,
      date: ymd(date),
      weekday: date.getUTCDay(),
      weekdayLabel: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()],
      isWeekend: isWeekendUtc(date),
    });
  }
  return days;
}

async function getMonthlyDetails({ company, year, month }) {
  const days = buildMonthDays(year, month);
  const today = todayYmdIst();
  const [employees, balancesMap, requests, manualEntries] = await Promise.all([
    getEmployees(company),
    getBalancesMap(company),
    getApprovedTimeOff(company, year),
    getManualDayEntries(company, year, month),
  ]);

  const aliasToCanonical = buildAliasIndex(employees);
  const dayMaps = buildDayMaps({ requests, manualEntries, year, aliasToCanonical });
  const presentSet = await buildPresentKeySet({
    company,
    year,
    month,
    employees,
    aliasToCanonical,
  });

  const rows = employees.map((emp, idx) => {
    const dayMap = getEmployeeDayMap(dayMaps, emp.employeeId, aliasToCanonical);
    const cells = {};
    const summary = emptyDaySummary();

    for (const dayInfo of days) {
      const leaveCell = dayMap.get(dayInfo.date);
      const leaveCode = leaveCell?.cleared ? null : leaveCell?.code || null;
      const hasPresent = employeeIsPresentOn(
        presentSet,
        emp.employeeId,
        dayInfo.date,
        aliasToCanonical
      );
      const resolved = resolveDayDisplay({
        date: dayInfo.date,
        isWeekend: dayInfo.isWeekend,
        leaveCode,
        hasPresent,
        today,
      });

      cells[dayInfo.date] = {
        code: resolved.code,
        display: resolved.display,
        status: resolved.status,
        editable: resolved.editable,
        leaveCode: leaveCode || null,
        hasPresent: Boolean(hasPresent),
        source: leaveCell?.source || (hasPresent ? 'checkin' : null),
        cleared: Boolean(leaveCell?.cleared),
      };

      // Totals: count leave/WFH only when that is what the cell shows (not overridden by P)
      if (resolved.status === 'leave' && leaveCode) {
        addCodeToSummary(summary, leaveCode);
      }
      if (resolved.status === 'present') summary.present += 1;
      if (resolved.status === 'absent') summary.absent += 1;
    }

    const bal = getBalance(balancesMap, emp.employeeId, emp.aliases);

    return {
      sno: idx + 1,
      employeeId: emp.employeeId,
      employeeCode: emp.employeeCode,
      employeeName: emp.employeeName,
      isActive: emp.isActive,
      status: emp.status,
      isExited: emp.isExited,
      cells,
      summary,
      balanceLeaves: safeLeaveDays(bal[BALANCE_LEAVE_KEY], 0),
      balanceWfh: safeLeaveDays(bal[BALANCE_WFH_KEY], 0),
    };
  });

  return {
    year,
    month,
    days,
    today,
    dayCodes: DAY_CODES,
    codeMeta: CODE_META,
    sources: {
      balances: LEAVE_BALANCES_COLLECTION,
      taken: ATTENDANCE_REQUESTS_COLLECTION,
      checkins: CHECKINS_COLLECTION,
      machine: 'machine_attendance_reports',
      overrides: DAY_ENTRIES_COLLECTION,
      leaveTypes: [BALANCE_LEAVE_KEY, BALANCE_WFH_KEY],
    },
    rows,
  };
}

function resolveEffectiveCode(dayMap, date) {
  const cell = dayMap?.get(date);
  if (!cell || cell.cleared) return null;
  return cell.code || null;
}

async function setDayEntry({
  company,
  employeeId,
  date,
  code,
  performedBy = 'HR',
  reason = '',
}) {
  const empId = String(employeeId || '').trim();
  const dateKey = String(date || '').trim();
  if (!empId) return { ok: false, error: 'employeeId is required' };
  if (!parseYmd(dateKey)) return { ok: false, error: 'date must be YYYY-MM-DD' };

  const nextCode =
    code == null || code === '' || String(code).toUpperCase() === 'CLEAR'
      ? null
      : String(code).toUpperCase();
  if (nextCode && !CODE_META[nextCode]) {
    return { ok: false, error: `Invalid code. Use: ${DAY_CODES.join(', ')} or clear` };
  }

  const year = Number(dateKey.slice(0, 4));
  const [employees, requests, manualEntries] = await Promise.all([
    getEmployees(company),
    getApprovedTimeOff(company, year),
    getManualDayEntries(company, year),
  ]);
  const aliasToCanonical = buildAliasIndex(employees);
  const dayMaps = buildDayMaps({ requests, manualEntries, year, aliasToCanonical });
  const dayMap = getEmployeeDayMap(dayMaps, empId, aliasToCanonical);
  const prevCode = resolveEffectiveCode(dayMap, dateKey);

  if (prevCode === nextCode) {
    return {
      ok: true,
      unchanged: true,
      employeeId: empId,
      date: dateKey,
      code: nextCode,
    };
  }

  // Adjust same leave_balances collection used by Leave Balance tab
  if (prevCode && CODE_META[prevCode]) {
    const prevMeta = CODE_META[prevCode];
    await applyBalanceDelta({
      company,
      employeeId: empId,
      leaveKey: prevMeta.leaveType,
      delta: prevMeta.days,
      reason: reason || `Leaves & WFH Details: removed ${prevCode} on ${dateKey}`,
      performedBy,
    });
  }

  if (nextCode && CODE_META[nextCode]) {
    const nextMeta = CODE_META[nextCode];
    await applyBalanceDelta({
      company,
      employeeId: empId,
      leaveKey: nextMeta.leaveType,
      delta: -nextMeta.days,
      reason: reason || `Leaves & WFH Details: set ${nextCode} on ${dateKey}`,
      performedBy,
    });
  }

  const db = await getEmployeeDbForHrms(company);
  const col = db.collection(DAY_ENTRIES_COLLECTION);
  const now = new Date();

  if (!nextCode) {
    await col.updateOne(
      { company, employeeId: empId, date: dateKey },
      {
        $set: {
          company,
          employeeId: empId,
          date: dateKey,
          code: null,
          cleared: true,
          source: 'manual',
          updatedBy: performedBy,
          updatedAt: now,
          reason: reason || 'Cleared day status',
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
  } else {
    await col.updateOne(
      { company, employeeId: empId, date: dateKey },
      {
        $set: {
          company,
          employeeId: empId,
          date: dateKey,
          code: nextCode,
          cleared: false,
          source: 'manual',
          leaveType: CODE_META[nextCode].leaveType,
          days: CODE_META[nextCode].days,
          updatedBy: performedBy,
          updatedAt: now,
          reason: reason || `Manual set ${nextCode}`,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
  }

  return {
    ok: true,
    employeeId: empId,
    date: dateKey,
    previousCode: prevCode,
    code: nextCode,
  };
}

module.exports = {
  DAY_CODES,
  CODE_META,
  getYearlySummary,
  getMonthlyDetails,
  setDayEntry,
};
