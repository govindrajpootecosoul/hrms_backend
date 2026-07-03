/**
 * Long-running attendance reminder scheduler (production PM2 worker).
 * Keeps process alive and fires morning/evening reminders on office weekdays.
 */
require('dotenv').config();
const { connectMongo, LOGIN_DB_NAME } = require('../config/mongo');
const { ensureReminderLogIndexes } = require('../portals/employee/services/attendanceReminderService');
const { startAttendanceReminderScheduler } = require('../lib/attendanceReminderScheduler');

async function main() {
  await connectMongo(LOGIN_DB_NAME);
  await ensureReminderLogIndexes();
  startAttendanceReminderScheduler();
  console.log('[attendance-reminder-daemon] running');
}

main().catch((err) => {
  console.error('[attendance-reminder-daemon] fatal:', err);
  process.exit(1);
});
