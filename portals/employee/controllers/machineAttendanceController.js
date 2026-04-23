const { connectMongo, getDb, LOGIN_DB_NAME, getUsersCollection } = require('../../../config/mongo');
const { getCompanyFromRequest } = require('../utils/employeeContext');

function firstQueryValue(val, fallback) {
  if (val == null || val === '') return fallback;
  const v = Array.isArray(val) ? val[0] : val;
  const s = String(v).trim();
  return s || fallback;
}

function normalizeEmpCode(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s ? s : null;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseYyyyMmDd(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return isValidDate(d) ? d : null;
}

function parseDateRange(req) {
  const startDate = firstQueryValue(req.query.startDate, null);
  const endDate = firstQueryValue(req.query.endDate, null);
  if (!startDate || !endDate) return null;
  const start = parseYyyyMmDd(startDate);
  const end = parseYyyyMmDd(endDate);
  if (!start || !end) return null;
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  if (start > end) return null;
  return { startDate, endDate, start, end };
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
      console.warn(`[employee/machine-attendance] Skipping db '${dbName}':`, e.message);
    }
  }
  return all;
}

async function getMachineAttendance(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const range = parseDateRange(req);
    if (!range) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range. Provide startDate and endDate as YYYY-MM-DD.',
      });
    }

    const empCodeRaw = firstQueryValue(req.query.empCode, null) || firstQueryValue(req.query.employeeCode, null);
    const empCode = normalizeEmpCode(empCodeRaw);
    if (!empCode) {
      return res.status(400).json({ success: false, error: 'empCode is required' });
    }

    await connectMongo();

    // Company scoping: only allow emp codes that belong to this company.
    const usersCol = await getUsersCollection(null, company);
    const employee = await usersCol.findOne(
      { company, emp_code: empCode },
      { projection: { emp_code: 1, name: 1, employeeId: 1, email: 1, department: 1 } }
    );
    if (!employee) {
      return res.json({ success: true, data: { empCode, records: [] } });
    }

    let docs = await getMachineAttendanceForRange(range);
    docs = docs.filter((d) => normalizeEmpCode(d?.emp_code) === empCode);

    const records = docs
      .map((d) => {
        const dateRaw = d.date;
        const dateStr = typeof dateRaw === 'string' ? String(dateRaw) : new Date(dateRaw).toISOString();
        return {
          empCode,
          date: dateStr.slice(0, 10),
          punchIn: d.punch_in != null && String(d.punch_in).trim() !== '' ? String(d.punch_in).trim() : null,
          punchOut: d.punch_out != null && String(d.punch_out).trim() !== '' ? String(d.punch_out).trim() : null,
          status: d.status != null ? String(d.status) : '',
          shift: d.shift || d.shift_code || d.shiftCode || '',
          hoursWorked: d.hours_worked ?? d.hoursWorked ?? null,
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return res.json({
      success: true,
      data: {
        empCode,
        employee: {
          name: employee.name || '',
          employeeId: employee.employeeId || employee.email?.split('@')[0] || '',
          department: employee.department || '',
        },
        records,
      },
    });
  } catch (err) {
    console.error('[employee/machine-attendance] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { getMachineAttendance };

