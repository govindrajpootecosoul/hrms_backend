const LEAVE_WFH_PAST_DAYS = 30;
const LEAVE_WFH_FUTURE_DAYS = 60;

function startOfUtcDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function parseYyyyMmDd(s) {
  if (!s) return null;
  const d = new Date(`${String(s).trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatUtcDay(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLeaveWfhDateWindow(referenceDate = new Date()) {
  const today = startOfUtcDay(referenceDate);
  const min = new Date(today);
  min.setUTCDate(min.getUTCDate() - LEAVE_WFH_PAST_DAYS);
  const max = new Date(today);
  max.setUTCDate(max.getUTCDate() + LEAVE_WFH_FUTURE_DAYS);
  return { min, max, today };
}

function isDateInLeaveWfhWindow(date, referenceDate = new Date()) {
  if (!date) return false;
  const d = startOfUtcDay(date);
  const { min, max } = getLeaveWfhDateWindow(referenceDate);
  return d.getTime() >= min.getTime() && d.getTime() <= max.getTime();
}

function leaveWfhWindowErrorMessage(referenceDate = new Date()) {
  const { min, max } = getLeaveWfhDateWindow(referenceDate);
  return `You can apply only from ${formatUtcDay(min)} to ${formatUtcDay(max)} (up to ${LEAVE_WFH_PAST_DAYS} days in the past and ${LEAVE_WFH_FUTURE_DAYS} days ahead).`;
}

function validateLeaveWfhSingleDate(dateStr, referenceDate = new Date()) {
  const d = parseYyyyMmDd(dateStr);
  if (!d) {
    return { ok: false, error: 'Invalid date format.' };
  }
  if (!isDateInLeaveWfhWindow(d, referenceDate)) {
    return { ok: false, error: leaveWfhWindowErrorMessage(referenceDate) };
  }
  return { ok: true };
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
  if (start > end) return null;
  return { start, end };
}

function validateLeaveWfhDateRange(dateRange, referenceDate = new Date()) {
  const parsed = parseDateRangeString(dateRange);
  if (!parsed) {
    return { ok: false, error: 'Invalid date range format.' };
  }
  if (
    !isDateInLeaveWfhWindow(parsed.start, referenceDate) ||
    !isDateInLeaveWfhWindow(parsed.end, referenceDate)
  ) {
    return { ok: false, error: leaveWfhWindowErrorMessage(referenceDate) };
  }
  return { ok: true };
}

module.exports = {
  LEAVE_WFH_PAST_DAYS,
  LEAVE_WFH_FUTURE_DAYS,
  getLeaveWfhDateWindow,
  isDateInLeaveWfhWindow,
  leaveWfhWindowErrorMessage,
  validateLeaveWfhSingleDate,
  validateLeaveWfhDateRange,
};
