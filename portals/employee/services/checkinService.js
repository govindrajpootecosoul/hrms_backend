const { getDb, getEmployeePortalDb } = require('../../../config/mongo');
const { EMPLOYEE_CHECKINS } = require('../models');

function todayYMD() {
  return new Date().toISOString().split('T')[0];
}

async function getCheckinsCollection(company) {
  const db = company ? await getEmployeePortalDb(company) : await getDb();
  return db.collection(EMPLOYEE_CHECKINS);
}

async function ensureNotCheckedIn(col, employeeId, today) {
  const existing = await col.findOne({ employeeId, date: today, checkOutTime: null });
  if (existing) {
    const err = new Error('Already checked in today. Please check out first.');
    err.statusCode = 400;
    throw err;
  }
}

async function computeAccumulatedMinutes(col, employeeId, today) {
  const todayCheckIns = await col.find({ employeeId, date: today }).toArray();
  let accumulatedMinutes = 0;
  for (const record of todayCheckIns) {
    if (record.checkOutTime && record.totalMinutes && record.totalMinutes > accumulatedMinutes) {
      accumulatedMinutes = record.totalMinutes;
    }
  }
  return accumulatedMinutes;
}

async function checkinEmployee({ employeeId, company }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getCheckinsCollection(company);
  const today = todayYMD();

  await ensureNotCheckedIn(col, employeeId, today);

  const accumulatedMinutes = await computeAccumulatedMinutes(col, employeeId, today);

  const checkInTime = new Date();
  const checkInDoc = {
    employeeId,
    date: today,
    checkInTime: checkInTime.toISOString(),
    checkOutTime: null,
    totalMinutes: accumulatedMinutes,
    status: 'checked-in',
    createdAt: checkInTime,
    updatedAt: checkInTime,
  };

  await col.insertOne(checkInDoc);

  return {
    checkInTime: checkInDoc.checkInTime,
    status: 'checked-in',
    totalMinutes: accumulatedMinutes,
    employeeId,
  };
}

async function checkoutEmployee({ employeeId, company }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getCheckinsCollection(company);
  const today = todayYMD();

  const checkIn = await col.findOne({ employeeId, date: today, checkOutTime: null });
  if (!checkIn) {
    const err = new Error('No active check-in found. Please check in first.');
    err.statusCode = 400;
    throw err;
  }

  const checkOutTime = new Date();
  const checkInTime = new Date(checkIn.checkInTime);
  const sessionMinutes = Math.max(0, (checkOutTime.getTime() - checkInTime.getTime()) / 60000);
  const totalMinutes = (checkIn.totalMinutes || 0) + sessionMinutes;

  await col.updateOne(
    { _id: checkIn._id },
    {
      $set: {
        checkOutTime: checkOutTime.toISOString(),
        totalMinutes,
        status: 'checked-out',
        updatedAt: checkOutTime,
      },
    }
  );

  return {
    checkOutTime: checkOutTime.toISOString(),
    totalMinutes,
    totalHours: (totalMinutes / 60).toFixed(2),
    status: 'checked-out',
    employeeId,
  };
}

async function getTodayStatus({ employeeId, company, cache }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const cacheKey = `${company || 'default'}:${employeeId}`;
  const nowTs = Date.now();

  if (cache) {
    const cached = cache.map.get(cacheKey);
    if (cached && nowTs - cached.ts < cache.ttlMs) {
      return cached.data;
    }
  }

  const col = await getCheckinsCollection(company);
  const today = todayYMD();

  const mostRecentCheckIn = await col
    .find({ employeeId, date: today })
    .sort({ checkInTime: -1 })
    .limit(1)
    .project({ checkInTime: 1, checkOutTime: 1, totalMinutes: 1, status: 1 })
    .next();

  if (!mostRecentCheckIn) {
    const data = {
      status: 'checked-out',
      checkInTime: null,
      checkOutTime: null,
      totalMinutes: 0,
      employeeId,
    };
    if (cache) cache.map.set(cacheKey, { ts: nowTs, data });
    return data;
  }

  let totalMinutes = mostRecentCheckIn.totalMinutes || 0;
  let status = mostRecentCheckIn.status || (mostRecentCheckIn.checkOutTime ? 'checked-out' : 'checked-in');

  if (mostRecentCheckIn.checkInTime && !mostRecentCheckIn.checkOutTime) {
    const checkInTime = new Date(mostRecentCheckIn.checkInTime);
    const now = new Date();
    const currentSessionMinutes = Math.max(0, (now.getTime() - checkInTime.getTime()) / 60000);
    totalMinutes = (mostRecentCheckIn.totalMinutes || 0) + currentSessionMinutes;
    status = 'checked-in';
  } else {
    status = 'checked-out';
  }

  const data = {
    status,
    checkInTime: mostRecentCheckIn.checkInTime || null,
    checkOutTime: mostRecentCheckIn.checkOutTime || null,
    totalMinutes,
    employeeId,
  };

  if (cache) cache.map.set(cacheKey, { ts: nowTs, data });
  return data;
}

async function getHistory({ employeeId, company, limit = 30 }) {
  if (!employeeId) {
    const err = new Error('Employee ID is required');
    err.statusCode = 400;
    throw err;
  }

  const col = await getCheckinsCollection(company);
  const history = await col
    .find({ employeeId })
    .sort({ date: -1, checkInTime: -1 })
    .limit(limit)
    .toArray();

  return {
    employeeId,
    history: history.map((record) => ({
      date: record.date,
      checkInTime: record.checkInTime,
      checkOutTime: record.checkOutTime,
      totalMinutes: record.totalMinutes,
      totalHours: record.totalMinutes ? (record.totalMinutes / 60).toFixed(2) : 0,
      status: record.status,
    })),
  };
}

module.exports = {
  checkinEmployee,
  checkoutEmployee,
  getTodayStatus,
  getHistory,
};