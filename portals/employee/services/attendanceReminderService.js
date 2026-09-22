const { getUsersCollection, LOGIN_DB_NAME, getDb } = require('../../../config/mongo');
const { isGraphMailConfigured, sendMail } = require('../../../lib/microsoftGraphMail');
const { getFrontendUrl } = require('../../../config/app.config');
const { normalizeCompany, companyQuery, getAllHrmsDbs } = require('../../hrms/utils/hrmsContext');
const { getRequestsCollection } = require('./attendanceRequestsService');

const REMINDER_LOG_COLLECTION = 'attendance_reminder_log';
const COMPANIES = ['Ecosoul Home', 'Thrive'];

function parseOfficeTzOffsetMinutes() {
  const raw = process.env.OFFICE_TZ_OFFSET || '+05:30';
  const match = String(raw).trim().match(/^([+-])(\d{1,2}):(\d{2})$/);
  if (!match) return 330;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}

function getOfficeNow(date = new Date()) {
  const offsetMin = parseOfficeTzOffsetMinutes();
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utcMs + offsetMin * 60000);
}

function officeYmd(date = getOfficeNow()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekdayOffice(date = getOfficeNow()) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function isWeekdayForYmd(ymd) {
  const d = parseYyyyMmDd(ymd);
  if (!d) return isWeekdayOffice();
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

function parseYyyyMmDd(s) {
  if (!s) return null;
  const d = new Date(`${String(s).trim()}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
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

function ymdInRange(ymd, range) {
  if (!ymd || !range) return false;
  const d = parseYyyyMmDd(ymd);
  if (!d) return false;
  d.setUTCHours(12, 0, 0, 0);
  return d >= range.start && d <= range.end;
}

function employeeDisplayName(emp) {
  return (
    (emp?.name && String(emp.name).trim()) ||
    (emp?.firstName && String(emp.firstName).trim()) ||
    emp?.email?.split('@')[0] ||
    'Team Member'
  );
}

function employeeKey(emp) {
  return String(emp?.employeeId || emp?.email || emp?._id || '').trim();
}

async function getReminderLogCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(REMINDER_LOG_COLLECTION);
}

async function ensureReminderLogIndexes() {
  const col = await getReminderLogCollection();
  await col.createIndex(
    { company: 1, employeeId: 1, dateYmd: 1, slot: 1 },
    { unique: true, name: 'uniq_attendance_reminder_per_day' }
  );
  await col.createIndex({ dateYmd: 1, slot: 1 }, { name: 'attendance_reminder_by_date' });
}

async function wasReminderSent({ company, employeeId, dateYmd, slot }) {
  const col = await getReminderLogCollection();
  const doc = await col.findOne({
    company: normalizeCompany(company),
    employeeId: String(employeeId),
    dateYmd,
    slot,
  });
  return Boolean(doc);
}

async function markReminderSent({ company, employeeId, email, slot, dateYmd }) {
  const col = await getReminderLogCollection();
  const now = new Date();
  await col.updateOne(
    {
      company: normalizeCompany(company),
      employeeId: String(employeeId),
      dateYmd,
      slot,
    },
    {
      $set: {
        company: normalizeCompany(company),
        employeeId: String(employeeId),
        email: String(email || '').trim(),
        slot,
        dateYmd,
        sentAt: now,
      },
    },
    { upsert: true }
  );
}

async function loadActiveEmployees(company) {
  const usersCol = await getUsersCollection();
  return usersCol
    .find({
      ...companyQuery(company),
      // Strictly send reminders only to employees marked active.
      // (Do not treat missing `isActive` as active for reminder emails.)
      isActive: true,
      // Toggle off => attendanceReminderEmails === false; missing/true => eligible
      attendanceReminderEmails: { $ne: false },
      email: { $regex: /@/ },
    })
    .project({
      name: 1,
      firstName: 1,
      email: 1,
      employeeId: 1,
      department: 1,
      attendanceReminderEmails: 1,
      isActive: 1,
    })
    .toArray();
}

async function loadApprovedAbsenceKeys(company, dateYmd) {
  const col = await getRequestsCollection(company);
  const requests = await col
    .find({
      status: 'approved',
      type: { $in: ['time-off', 'on-duty'] },
    })
    .project({ employeeId: 1, type: 1, date: 1, dateRange: 1, leaveType: 1 })
    .toArray();

  const absent = new Set();
  for (const req of requests) {
    const empId = String(req.employeeId || '').trim();
    if (!empId) continue;

    if (req.type === 'on-duty') {
      if (req.date === dateYmd) absent.add(empId);
      continue;
    }

    if (req.type === 'time-off') {
      const range = parseDateRangeString(req.dateRange);
      if (range && ymdInRange(dateYmd, range)) {
        absent.add(empId);
      }
    }
  }
  return absent;
}

function formatOfficeDateLabel(dateYmd) {
  const d = parseYyyyMmDd(dateYmd);
  if (!d) return dateYmd;
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function emailShell({ title, bodyHtml, portalUrl }) {
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;max-width:560px;line-height:1.55;">
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">${title}</p>
      ${bodyHtml}
      <p style="margin:24px 0 0;">
        <a href="${portalUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">
          Open Employee Portal
        </a>
      </p>
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">
        If you have already completed this step, you can safely ignore this reminder.
      </p>
      <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">— Vectorlytics HRMS</p>
    </div>
  `;
}

function buildCheckInReminderEmail({ name, dateYmd, portalUrl }) {
  const dateLabel = formatOfficeDateLabel(dateYmd);
  const subject = `Good Morning — Please Mark Your Attendance (${dateLabel})`;
  const html = emailShell({
    title: 'Morning Attendance Reminder',
    portalUrl,
    bodyHtml: `
      <p>Hello <strong>${name}</strong>,</p>
      <p>
        This is your friendly reminder to <strong>mark your attendance for today</strong>.
        Our office day begins at <strong>9:00 AM</strong>, and timely check-in helps keep attendance records accurate.
      </p>
      <p>
        <strong>What to do:</strong><br/>
        • Check in through the employee portal or biometric device before you start work.<br/>
        • If you are working from home or on official duty, ensure your request is already approved.
      </p>
      <p style="margin:0;color:#4b5563;"><em>Date: ${dateLabel}</em></p>
    `,
  });
  const text = [
    `Hello ${name},`,
    '',
    'Please mark your attendance for today. Office day begins at 9:00 AM.',
    `Date: ${dateLabel}`,
    '',
    `Open portal: ${portalUrl}`,
    '',
    '— Vectorlytics HRMS',
  ].join('\n');
  return { subject, html, text };
}

function buildCheckOutReminderEmail({ name, dateYmd, portalUrl }) {
  const dateLabel = formatOfficeDateLabel(dateYmd);
  const subject = `End of Day — Please Remember to Check Out (${dateLabel})`;
  const html = emailShell({
    title: 'Evening Check-Out Reminder',
    portalUrl,
    bodyHtml: `
      <p>Hello <strong>${name}</strong>,</p>
      <p>
        As the workday comes to a close, please remember to <strong>check out</strong> before you leave.
        Accurate check-out ensures your working hours are recorded correctly for payroll and compliance.
      </p>
      <p>
        <strong>What to do:</strong><br/>
        • Check out in the employee portal or via biometric before leaving for the day.<br/>
        • Standard office hours end at <strong>5:30 PM</strong> — please complete checkout on time.
      </p>
      <p style="margin:0;color:#4b5563;"><em>Date: ${dateLabel}</em></p>
    `,
  });
  const text = [
    `Hello ${name},`,
    '',
    'Please remember to check out before you leave today. Standard office hours end at 5:30 PM.',
    `Date: ${dateLabel}`,
    '',
    `Open portal: ${portalUrl}`,
    '',
    '— Vectorlytics HRMS',
  ].join('\n');
  return { subject, html, text };
}

async function sendReminderToEmployee({ company, employee, slot, dateYmd, portalUrl, dryRun = false }) {
  const empId = employeeKey(employee);
  const email = String(employee?.email || '').trim();
  if (!empId || !email) {
    return { skipped: true, reason: 'missing_employee_or_email' };
  }

  if (await wasReminderSent({ company, employeeId: empId, dateYmd, slot })) {
    return { skipped: true, reason: 'already_sent' };
  }

  const name = employeeDisplayName(employee);
  const mail =
    slot === 'evening'
      ? buildCheckOutReminderEmail({ name, dateYmd, portalUrl })
      : buildCheckInReminderEmail({ name, dateYmd, portalUrl });

  if (dryRun) {
    return { sent: false, dryRun: true, to: email, subject: mail.subject };
  }

  await sendMail({
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    internetMessageHeaders: [
      { name: 'X-Vectorlytics-Reminder', value: `attendance-${slot}` },
      { name: 'X-Vectorlytics-Date', value: dateYmd },
    ],
  });

  await markReminderSent({ company, employeeId: empId, email, slot, dateYmd });
  return { sent: true, to: email };
}

async function sendAttendanceReminders({
  slot,
  dateYmd = officeYmd(),
  dryRun = false,
  force = false,
  onlyEmail = null,
} = {}) {
  const normalizedSlot = slot === 'evening' ? 'evening' : 'morning';

  if (!force && !isWeekdayForYmd(dateYmd)) {
    return { skipped: true, reason: 'weekend', slot: normalizedSlot, dateYmd };
  }

  if (!dryRun && !isGraphMailConfigured()) {
    return { skipped: true, reason: 'mail_not_configured', slot: normalizedSlot, dateYmd };
  }

  const portalUrl = getFrontendUrl();
  const summary = {
    slot: normalizedSlot,
    dateYmd,
    dryRun,
    companies: {},
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const companyLabel of COMPANIES) {
    const company = normalizeCompany(companyLabel);
    const companyStats = { sent: 0, skipped: 0, failed: 0, total: 0 };

    try {
      await getAllHrmsDbs();
    } catch (_e) {
      // continue even if one company DB is unreachable
    }

    const [employees, absentKeys] = await Promise.all([
      loadActiveEmployees(company),
      loadApprovedAbsenceKeys(company, dateYmd),
    ]);

    for (const employee of employees) {
      const empId = employeeKey(employee);
      const email = String(employee?.email || '').trim().toLowerCase();
      if (onlyEmail && email !== String(onlyEmail).trim().toLowerCase()) {
        continue;
      }
      if (absentKeys.has(empId)) {
        companyStats.skipped += 1;
        summary.skipped += 1;
        continue;
      }
      if (employee.attendanceReminderEmails === false) {
        companyStats.skipped += 1;
        summary.skipped += 1;
        continue;
      }
      if (employee.isActive !== true) {
        companyStats.skipped += 1;
        summary.skipped += 1;
        continue;
      }

      companyStats.total += 1;
      try {
        const result = await sendReminderToEmployee({
          company,
          employee,
          slot: normalizedSlot,
          dateYmd,
          portalUrl,
          dryRun,
        });
        if (result.sent || result.dryRun) {
          companyStats.sent += 1;
          summary.sent += 1;
        } else {
          companyStats.skipped += 1;
          summary.skipped += 1;
        }
      } catch (err) {
        companyStats.failed += 1;
        summary.failed += 1;
        console.error(
          `[attendanceReminder] failed for ${employee?.email || empId} (${company}):`,
          err.message
        );
      }
    }

    summary.companies[company] = companyStats;
  }

  console.log('[attendanceReminder] complete', summary);
  return summary;
}

async function sendTestReminderEmail({ email, slot = 'morning', name = null }) {
  const to = String(email || '').trim();
  if (!to || !to.includes('@')) {
    throw new Error('Valid email is required for test send');
  }
  if (!isGraphMailConfigured()) {
    throw new Error('Microsoft Graph mail is not configured');
  }

  const normalizedSlot = slot === 'evening' ? 'evening' : 'morning';
  const portalUrl = getFrontendUrl();
  const dateYmd = officeYmd();
  const displayName = name || to.split('@')[0];
  const mail =
    normalizedSlot === 'evening'
      ? buildCheckOutReminderEmail({ name: displayName, dateYmd, portalUrl })
      : buildCheckInReminderEmail({ name: displayName, dateYmd, portalUrl });

  await sendMail({
    to: [to],
    subject: `[TEST] ${mail.subject}`,
    html: mail.html,
    text: mail.text,
  });

  return { sent: true, to, slot: normalizedSlot, subject: mail.subject };
}

module.exports = {
  getOfficeNow,
  officeYmd,
  isWeekdayOffice,
  ensureReminderLogIndexes,
  buildCheckInReminderEmail,
  buildCheckOutReminderEmail,
  sendAttendanceReminders,
  sendTestReminderEmail,
};
