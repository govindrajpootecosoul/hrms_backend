const PDFDocument = require('pdfkit');
const { connectMongo, getDb, LOGIN_DB_NAME, getUsersCollection } = require('../../../config/mongo');
const { getHistory } = require('./checkinService');
const { listRequests } = require('./attendanceRequestsService');

const MONTHS_BACK = 12;

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function asYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toDayName(ymd) {
  const dt = new Date(`${ymd}T12:00:00`);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Number.isNaN(dt.getTime()) ? '' : days[dt.getDay()];
}

function isWeekendYmd(ymd) {
  const dt = new Date(`${ymd}T12:00:00`);
  const day = dt.getDay();
  return day === 0 || day === 6;
}

function formatTimeForExport(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getExportDateRange() {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setMonth(start.getMonth() - MONTHS_BACK);
  return {
    startDate: asYmd(start),
    endDate: asYmd(end),
    start,
    end,
  };
}

function normalizeEmpCode(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s || null;
}

function machineDocMatchesEmpCode(doc, targetEmpCodeStr) {
  const raw = doc?.emp_code ?? doc?.empCode ?? doc?.employeeCode ?? doc?.employee_code;
  const a = normalizeEmpCode(raw);
  const b = normalizeEmpCode(targetEmpCodeStr);
  if (a == null || b == null) return false;
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

async function getMachineAttendanceForRange(range) {
  const dbNamesToTry = Array.from(new Set([LOGIN_DB_NAME, 'main_db'].filter((n) => n && String(n).trim() !== '')));
  const collectionNamesToTry = ['machine_attendance_reports', 'machine _attendance_reports'];
  const all = [];

  for (const dbName of dbNamesToTry) {
    try {
      const db = await getDb(dbName);
      const existingCols = new Set((await db.listCollections().toArray()).map((c) => c.name));
      for (const colName of collectionNamesToTry) {
        if (!existingCols.has(colName)) continue;
        const col = db.collection(colName);
        const docs = await col
          .find({
            $or: [
              { date: { $gte: range.start, $lte: range.end } },
              { date: { $gte: range.startDate, $lte: `${range.endDate}T99:99:99.999Z` } },
            ],
          })
          .toArray();
        all.push(...docs);
      }
    } catch (e) {
      console.warn(`[reportsExport] Skipping db '${dbName}':`, e.message);
    }
  }
  return all;
}

async function resolveEmployeeProfile({ employeeId, company, empCode }) {
  await connectMongo();
  const usersCol = await getUsersCollection(null, company);
  let employee = null;

  if (employeeId) {
    const q = { $or: [{ employeeId }, { employee_id: employeeId }] };
    if (company) q.company = company;
    employee = await usersCol.findOne(q, {
      projection: { company: 1, emp_code: 1, empCode: 1, employeeCode: 1, employee_code: 1, name: 1, employeeId: 1, email: 1, department: 1 },
    });
  }

  const resolvedEmpCode =
    normalizeEmpCode(empCode) ||
    normalizeEmpCode(employee?.emp_code ?? employee?.empCode ?? employee?.employeeCode ?? employee?.employee_code);

  return {
    employee,
    empCode: resolvedEmpCode,
    employeeName: employee?.name || '',
    employeeId: employee?.employeeId || employeeId || '',
  };
}

function ymdFromMachineRecord(r) {
  const iso = r?.dateIso;
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return asYmd(d);
  }
  const y = r?.date;
  if (y instanceof Date && !Number.isNaN(y.getTime())) return asYmd(y);
  if (y && /^\d{4}-\d{2}-\d{2}/.test(String(y).trim())) return String(y).trim().slice(0, 10);
  return '';
}

async function buildAttendanceExportRows({ employeeId, company, empCode }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const range = getExportDateRange();
  const profile = await resolveEmployeeProfile({ employeeId, company, empCode });
  const [historyResult, machineDocs] = await Promise.all([
    getHistory({ employeeId, company, limit: 400 }),
    profile.empCode ? getMachineAttendanceForRange(range) : Promise.resolve([]),
  ]);

  const checkinByDate = new Map();
  for (const record of historyResult.history || []) {
    if (!record?.date) continue;
    if (!checkinByDate.has(record.date)) checkinByDate.set(record.date, record);
  }

  const machineByDate = new Map();
  for (const doc of machineDocs) {
    if (!machineDocMatchesEmpCode(doc, profile.empCode)) continue;
    const dayKey = ymdFromMachineRecord(doc);
    if (!dayKey) continue;
    machineByDate.set(dayKey, doc);
  }

  const rows = [];
  const cur = new Date(range.start);
  while (cur <= range.end) {
    const ymd = asYmd(cur);
    const manual = checkinByDate.get(ymd);
    const machine = machineByDate.get(ymd);
    const weekend = isWeekendYmd(ymd);

    if (manual?.checkInTime) {
      const hours = manual.totalMinutes ? Number((manual.totalMinutes / 60).toFixed(2)) : 0;
      rows.push({
        date: ymd,
        day: toDayName(ymd),
        status: weekend ? 'Weekend' : 'Present',
        punchIn: formatTimeForExport(manual.checkInTime),
        punchOut: formatTimeForExport(manual.checkOutTime || machine?.punch_out || ''),
        hours,
      });
    } else if (machine) {
      const machineStatus = String(machine.status || '').trim() || (weekend ? 'Weekend' : 'Present');
      rows.push({
        date: ymd,
        day: toDayName(ymd),
        status: machineStatus,
        punchIn: formatTimeForExport(machine.punch_in || ''),
        punchOut: formatTimeForExport(machine.punch_out || ''),
        hours:
          machine.hours_worked != null && machine.hours_worked !== ''
            ? Number(machine.hours_worked)
            : machine.hoursWorked != null && machine.hoursWorked !== ''
              ? Number(machine.hoursWorked)
              : 0,
      });
    } else if (!weekend) {
      rows.push({
        date: ymd,
        day: toDayName(ymd),
        status: 'Absent',
        punchIn: '',
        punchOut: '',
        hours: 0,
      });
    } else {
      rows.push({
        date: ymd,
        day: toDayName(ymd),
        status: 'Weekend',
        punchIn: '',
        punchOut: '',
        hours: 0,
      });
    }

    cur.setDate(cur.getDate() + 1);
  }

  return {
    employeeName: profile.employeeName,
    employeeId: profile.employeeId,
    range,
    rows: rows.sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

async function buildRequestsExportRows({ employeeId, company }) {
  const { requests } = await listRequests({ employeeId, company });
  const range = getExportDateRange();
  const cutoff = range.start;

  const rows = (requests || [])
    .filter((req) => {
      const submitted = req.submittedAt ? new Date(req.submittedAt) : null;
      if (!submitted || Number.isNaN(submitted.getTime())) return true;
      return submitted >= cutoff;
    })
    .map((req) => ({
      id: req.id ? String(req.id) : '',
      type: req.type || '',
      status: req.status || '',
      leaveType: req.leaveType || '',
      date: req.date || '',
      dateRange: req.dateRange || '',
      timeWindow: req.timeWindow || '',
      location: req.location || '',
      reason: req.reason || '',
      notes: req.notes || req.details || '',
      submittedAt: req.submittedAt ? new Date(req.submittedAt).toISOString() : '',
      approvedAt: req.approvedAt ? new Date(req.approvedAt).toISOString() : '',
      rejectedAt: req.rejectedAt ? new Date(req.rejectedAt).toISOString() : '',
      rejectionReason: req.rejectionReason || '',
    }));

  return { rows };
}

function rowsToCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function attendanceToCsv({ employeeName, employeeId, range, rows }) {
  const headers = ['date', 'day', 'status', 'punchIn', 'punchOut', 'hours'];
  const meta = [
    `Employee,${csvEscape(employeeName)}`,
    `Employee ID,${csvEscape(employeeId)}`,
    `Period,${csvEscape(`${range.startDate} to ${range.endDate}`)}`,
    '',
    headers.join(','),
  ];
  const body = rows.map((r) =>
    [r.date, r.day, r.status, r.punchIn, r.punchOut, r.hours].map(csvEscape).join(',')
  );
  return `${meta.join('\r\n')}\r\n${body.join('\r\n')}\r\n`;
}

function requestsToCsv({ rows }) {
  const headers = [
    'id',
    'type',
    'status',
    'leaveType',
    'date',
    'dateRange',
    'timeWindow',
    'location',
    'reason',
    'notes',
    'submittedAt',
    'approvedAt',
    'rejectedAt',
    'rejectionReason',
  ];
  return rowsToCsv(headers, rows);
}

function attendanceToPdf({ employeeName, employeeId, range, rows }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Attendance History Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Employee: ${employeeName || employeeId || '—'}`);
    doc.text(`Employee ID: ${employeeId || '—'}`);
    doc.text(`Period: ${range.startDate} to ${range.endDate}`);
    doc.moveDown();

    const presentRows = rows.filter((r) => String(r.status).toLowerCase() !== 'weekend');
    presentRows.slice(0, 120).forEach((row, index) => {
      doc.fontSize(9).text(`${index + 1}. ${row.date} (${row.day}) — ${row.status}`, { continued: false });
      doc.fontSize(8);
      doc.text(`   In: ${row.punchIn || '—'}   Out: ${row.punchOut || '—'}   Hours: ${row.hours ?? 0}`);
      doc.moveDown(0.25);
    });

    if (presentRows.length > 120) {
      doc.moveDown();
      doc.fontSize(8).text(`… and ${presentRows.length - 120} more day(s). Use CSV for the full export.`);
    }

    doc.end();
  });
}

module.exports = {
  buildAttendanceExportRows,
  buildRequestsExportRows,
  attendanceToCsv,
  requestsToCsv,
  attendanceToPdf,
  getExportDateRange,
};
