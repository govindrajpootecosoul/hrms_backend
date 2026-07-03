const {
  getOfficeNow,
  officeYmd,
  isWeekdayOffice,
  sendAttendanceReminders,
} = require('../portals/employee/services/attendanceReminderService');

const MORNING_HOUR = parseInt(process.env.ATTENDANCE_REMINDER_MORNING_HOUR || '9', 10);
const MORNING_MINUTE = parseInt(process.env.ATTENDANCE_REMINDER_MORNING_MINUTE || '0', 10);
const EVENING_HOUR = parseInt(process.env.ATTENDANCE_REMINDER_EVENING_HOUR || '17', 10);
const EVENING_MINUTE = parseInt(process.env.ATTENDANCE_REMINDER_EVENING_MINUTE || '30', 10);
const CHECK_INTERVAL_MS = 60_000;

let schedulerStarted = false;
let runningSlot = null;
let lastMorningRunYmd = '';
let lastEveningRunYmd = '';

async function runSlot(slot) {
  if (runningSlot) return;
  runningSlot = slot;
  try {
    await sendAttendanceReminders({ slot });
  } catch (err) {
    console.error(`[attendanceReminderScheduler] ${slot} run failed:`, err.message);
  } finally {
    runningSlot = null;
  }
}

function tick() {
  if (!isWeekdayOffice()) return;

  const officeNow = getOfficeNow();
  const ymd = officeYmd(officeNow);
  const hour = officeNow.getHours();
  const minute = officeNow.getMinutes();

  if (hour === MORNING_HOUR && minute === MORNING_MINUTE && lastMorningRunYmd !== ymd) {
    lastMorningRunYmd = ymd;
    runSlot('morning');
  }

  if (hour === EVENING_HOUR && minute === EVENING_MINUTE && lastEveningRunYmd !== ymd) {
    lastEveningRunYmd = ymd;
    runSlot('evening');
  }
}

function startAttendanceReminderScheduler() {
  if (schedulerStarted) return;
  if (process.env.ATTENDANCE_REMINDER_CRON !== 'true') return;

  schedulerStarted = true;
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log(
    `[attendanceReminderScheduler] enabled — morning ${String(MORNING_HOUR).padStart(2, '0')}:${String(MORNING_MINUTE).padStart(2, '0')}, evening ${String(EVENING_HOUR).padStart(2, '0')}:${String(EVENING_MINUTE).padStart(2, '0')} (office TZ)`
  );
}

module.exports = {
  startAttendanceReminderScheduler,
};
