/** Office wall-clock helpers for employee_checkins (store H:MM, read ISO or legacy ISO). */

function getOfficeTzOffset() {
  return process.env.OFFICE_TZ_OFFSET || '+05:30';
}

function parseOffsetMinutes(offset) {
  const match = String(offset).match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 330;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function officeLocalParts(date) {
  const offMin = parseOffsetMinutes(getOfficeTzOffset());
  const localMs = date.getTime() + offMin * 60000;
  const ld = new Date(localMs);
  return { hours24: ld.getUTCHours(), minutes: ld.getUTCMinutes() };
}

/** Store as 12-hour H:MM without AM/PM (e.g. 9:17, 6:09). */
function dateToOfficeHm(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const { hours24, minutes } = officeLocalParts(date);
  let h12 = hours24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(minutes).padStart(2, '0')}`;
}

function isHmTimeString(value) {
  return typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim());
}

function isIsoTimeString(value) {
  return typeof value === 'string' && value.includes('T');
}

/** Convert office H:MM on dateYmd to UTC ISO (fixed office offset). */
function timeHmToIso(dateYmd, hm) {
  if (!dateYmd || !hm) return null;
  const mins24 = hm12ToMinutes24(hm, null);
  if (mins24 == null) return null;
  const h = Math.floor(mins24 / 60);
  const m = mins24 % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const offset = getOfficeTzOffset();
  const d = new Date(`${dateYmd}T${hh}:${mm}:00${offset}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Parse stored 12-hour H:MM to minutes since midnight (24h).
 * anchorMinutes: check-in minutes when parsing check-out on the same day.
 */
function hm12ToMinutes24(hm, anchorMinutes = null) {
  if (!hm) return null;
  const parts = String(hm).trim().split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59) return null;

  if (h >= 0 && h <= 23 && (h > 12 || anchorMinutes == null)) {
    if (h > 12) return h * 60 + m;
  }

  if (h < 1 || h > 12) return null;

  let mins;
  if (h === 12) {
    mins = 12 * 60 + m;
  } else {
    mins = h * 60 + m;
  }

  if (anchorMinutes != null) {
    if (mins <= anchorMinutes) {
      if (h !== 12) mins += 12 * 60;
    }
    return mins;
  }

  if (h >= 9 && h <= 11) return h * 60 + m;
  if (h >= 1 && h <= 7) return (h + 12) * 60 + m;
  if (h === 8) return 8 * 60 + m;
  if (h === 12) return 12 * 60 + m;
  return h * 60 + m;
}

function storedCheckTimeToIso(dateYmd, stored, anchorStored = null) {
  if (stored == null || stored === '') return null;
  if (stored instanceof Date) return stored.toISOString();
  const s = String(stored).trim();
  if (isHmTimeString(s)) {
    const anchorMins = anchorStored ? hm12ToMinutes24(anchorStored, null) : null;
    const mins = hm12ToMinutes24(s, anchorMins);
    if (mins == null) return null;
    const h = Math.floor(mins / 60);
    const mm = mins % 60;
    const hh = String(h).padStart(2, '0');
    const minStr = String(mm).padStart(2, '0');
    const offset = getOfficeTzOffset();
    const d = new Date(`${dateYmd}T${hh}:${minStr}:00${offset}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (isIsoTimeString(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function storedCheckTimeToDate(dateYmd, stored, anchorStored = null) {
  const iso = storedCheckTimeToIso(dateYmd, stored, anchorStored);
  return iso ? new Date(iso) : null;
}

function minutesBetweenStored(dateYmd, inStored, outStored) {
  const inIso = storedCheckTimeToIso(dateYmd, inStored);
  const outIso = storedCheckTimeToIso(dateYmd, outStored, inStored);
  if (!inIso || !outIso) return 0;
  const a = new Date(inIso).getTime();
  const b = new Date(outIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 60000);
}

module.exports = {
  dateToOfficeHm,
  isHmTimeString,
  isIsoTimeString,
  timeHmToIso,
  hm12ToMinutes24,
  storedCheckTimeToIso,
  storedCheckTimeToDate,
  minutesBetweenStored,
  getOfficeTzOffset,
};
