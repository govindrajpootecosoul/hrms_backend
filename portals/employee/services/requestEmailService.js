const { ObjectId } = require('mongodb');
const { getUsersCollection, LOGIN_DB_NAME, getDb } = require('../../../config/mongo');
const { isGraphMailConfigured, sendMail, normalizeEmailList } = require('../../../lib/microsoftGraphMail');
const { normalizeCompany, companyQuery } = require('../../hrms/utils/hrmsContext');
const { getRequestsCollection } = require('./attendanceRequestsService');

const DEPARTMENT_MANAGERS_COLLECTION = 'department_managers';

function normalizeDept(v) {
  return String(v || '').trim();
}

function normalizeDeptKey(v) {
  return normalizeDept(v).toLowerCase();
}

function isHrDepartment(dept) {
  const d = normalizeDeptKey(dept);
  return d === 'hr' || d === 'human resources' || d.startsWith('hr ') || d.includes('human resource');
}

function employeeIdQuery(employeeId) {
  const empId = String(employeeId || '').trim();
  if (!empId) return null;
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    $or: [
      { employeeId: empId },
      { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
      { email: new RegExp(`^${escapeRe(empId)}(@|$)`, 'i') },
    ],
  };
}

async function findApplicant(usersCol, company, employeeId) {
  const idQuery = employeeIdQuery(employeeId);
  if (!idQuery) return null;
  let applicant = await usersCol.findOne({ ...companyQuery(company), ...idQuery });
  if (!applicant) applicant = await usersCol.findOne(idQuery);
  return applicant;
}

async function getDepartmentManagersCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(DEPARTMENT_MANAGERS_COLLECTION);
}

async function findDepartmentManagerUserIds(company, department) {
  const deptKey = normalizeDeptKey(department);
  if (!deptKey) return [];

  const managersCol = await getDepartmentManagersCollection();
  const docs = await managersCol.find({ ...companyQuery(company) }).toArray();

  const ids = [];
  for (const doc of docs) {
    if (normalizeDeptKey(doc?.department) !== deptKey) continue;
    if (Array.isArray(doc.managerUserIds)) {
      ids.push(...doc.managerUserIds.map((id) => String(id)));
    } else if (doc.managerUserId) {
      ids.push(String(doc.managerUserId));
    }
  }
  return Array.from(new Set(ids.filter(Boolean)));
}

async function findHrmsAdminUserIds(usersCol, company) {
  const baseQuery = {
    ...companyQuery(company),
    role: { $in: ['admin', 'superadmin'] },
    isActive: { $ne: false },
  };

  const withHrmsPortal = await usersCol
    .find({ ...baseQuery, portals: { $regex: /hrms/i } })
    .toArray();

  const admins = withHrmsPortal.length ? withHrmsPortal : await usersCol.find(baseQuery).toArray();
  return admins.map((u) => u._id.toString());
}

function recipientEntry(user, role, label) {
  const email = String(user?.email || '').trim();
  if (!email || !email.includes('@')) return null;
  return {
    email,
    name: user.name || email,
    role,
    label: label || role,
  };
}

function dedupeRecipients(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item?.email) continue;
    const key = item.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function collectHrRecipientEntries(usersCol, company, applicant) {
  const hrEntries = [];
  const normalizedCompany = normalizeCompany(company);

  const hrMailKeys = ['hr_mail', 'hrMail', 'HR_MAIL', 'hrEmail', 'hr_email'];
  for (const key of hrMailKeys) {
    const raw = String(applicant?.[key] || '').trim();
    if (raw && raw.includes('@')) {
      hrEntries.push({ email: raw, name: 'HR', role: 'hr', label: 'HR Mail' });
    }
  }

  if (hrEntries.length) {
    return dedupeRecipients(hrEntries);
  }

  const hrDeptUsers = await usersCol
    .find({
      ...companyQuery(normalizedCompany),
      isActive: { $ne: false },
      department: { $regex: /^(hr|human resources)/i },
      email: { $regex: /@/ },
    })
    .project({ name: 1, email: 1, department: 1 })
    .toArray();

  for (const hrUser of hrDeptUsers) {
    const entry = recipientEntry(hrUser, 'hr', 'HR');
    if (entry) hrEntries.push(entry);
  }

  const hrAdminIds = await findHrmsAdminUserIds(usersCol, normalizedCompany);
  for (const hrId of hrAdminIds) {
    const hrUser = await usersCol.findOne({
      _id: ObjectId.isValid(hrId) ? new ObjectId(hrId) : hrId,
    });
    const entry = recipientEntry(hrUser, 'hr', 'HR');
    if (entry) hrEntries.push(entry);
  }

  return dedupeRecipients(hrEntries);
}

async function resolveDefaultRecipients({ employeeId, company }) {
  const normalizedCompany = normalizeCompany(company);
  const usersCol = await getUsersCollection();
  const applicant = await findApplicant(usersCol, normalizedCompany, employeeId);
  const dept = normalizeDept(applicant?.department || '');

  const ccRecipients = [];
  const requester = recipientEntry(applicant, 'requester', 'You (requester)');
  if (requester) ccRecipients.push(requester);

  const managerUserIds = dept ? await findDepartmentManagerUserIds(normalizedCompany, dept) : [];
  for (const managerId of managerUserIds) {
    const manager = await usersCol.findOne({
      _id: ObjectId.isValid(managerId) ? new ObjectId(managerId) : managerId,
    });
    const entry = recipientEntry(manager, 'manager', `Department Manager — ${dept || 'Team'}`);
    if (entry) ccRecipients.push(entry);
  }

  const toRecipients = await collectHrRecipientEntries(usersCol, normalizedCompany, applicant);
  const defaultCc = dedupeRecipients(ccRecipients);
  const defaultTo = dedupeRecipients(toRecipients);

  return {
    toEmails: defaultTo.map((c) => c.email),
    ccEmails: defaultCc.map((c) => c.email),
    toRecipients: defaultTo,
    ccRecipients: defaultCc,
  };
}

async function getEmailRecipients({ employeeId, company }) {
  const normalizedCompany = normalizeCompany(company);
  const usersCol = await getUsersCollection();
  const applicant = await findApplicant(usersCol, normalizedCompany, employeeId);
  const dept = normalizeDept(applicant?.department || '');

  const { toEmails, ccEmails, toRecipients, ccRecipients } = await resolveDefaultRecipients({
    employeeId,
    company: normalizedCompany,
  });

  const toOptions = [...toRecipients];
  const managerUserIds = dept ? await findDepartmentManagerUserIds(normalizedCompany, dept) : [];
  for (const managerId of managerUserIds) {
    const manager = await usersCol.findOne({
      _id: ObjectId.isValid(managerId) ? new ObjectId(managerId) : managerId,
    });
    const entry = recipientEntry(manager, 'manager', `Department Manager — ${dept || 'Team'}`);
    if (entry) toOptions.push(entry);
  }

  const otherUsers = await usersCol
    .find({
      ...companyQuery(normalizedCompany),
      isActive: { $ne: false },
      email: { $regex: /@/ },
    })
    .project({ name: 1, email: 1, department: 1, role: 1 })
    .limit(200)
    .toArray();

  for (const u of otherUsers) {
    const entry = recipientEntry(u, 'other', u.department ? `${u.name} (${u.department})` : u.name);
    if (entry) toOptions.push(entry);
  }

  const allSuggestions = dedupeRecipients(toOptions);
  const toSuggestions = allSuggestions.filter(
    (opt) =>
      (opt.role === 'hr' || opt.role === 'other') &&
      !ccRecipients.some((c) => c.email.toLowerCase() === opt.email.toLowerCase())
  );

  return {
    defaultTo: toEmails,
    defaultCc: ccEmails,
    toRecipients,
    ccRecipients,
    toSuggestions,
    ccSuggestions: allSuggestions,
    toOptions: toSuggestions,
    mailConfigured: isGraphMailConfigured(),
  };
}

function getRequestTypeLabel(requestDoc) {
  if (requestDoc.type === 'regularization') return 'Attendance Regularization';
  if (requestDoc.type === 'on-duty') return 'Work From Home';
  if (requestDoc.type === 'time-off' && requestDoc.leaveType === 'Work From Home') return 'Work From Home';
  if (requestDoc.type === 'time-off') return `Leave (${requestDoc.leaveType || 'Time Off'})`;
  return 'Attendance Request';
}

function buildRequestEmailHtml(requestDoc) {
  const name = requestDoc.employeeName || requestDoc.employeeId || 'Employee';
  const typeLabel = getRequestTypeLabel(requestDoc);
  const lines = [
    `<p><strong>${name}</strong> has submitted a <strong>${typeLabel}</strong> request.</p>`,
    `<p><strong>Status:</strong> ${requestDoc.status || 'pending'}</p>`,
  ];

  if (requestDoc.type === 'time-off') {
    lines.push(`<p><strong>Date range:</strong> ${requestDoc.dateRange || '—'}</p>`);
    lines.push(`<p><strong>Reason:</strong> ${requestDoc.reason || '—'}</p>`);
  } else if (requestDoc.type === 'regularization') {
    lines.push(`<p><strong>Date:</strong> ${requestDoc.date || '—'}</p>`);
    lines.push(`<p><strong>Time window:</strong> ${requestDoc.timeWindow || '—'}</p>`);
    if (requestDoc.notes) lines.push(`<p><strong>Notes:</strong> ${requestDoc.notes}</p>`);
  } else if (requestDoc.type === 'on-duty') {
    lines.push(`<p><strong>Date:</strong> ${requestDoc.date || '—'}</p>`);
    lines.push(`<p><strong>Location:</strong> ${requestDoc.location || '—'}</p>`);
    if (requestDoc.details) lines.push(`<p><strong>Details:</strong> ${requestDoc.details}</p>`);
  }

  if (requestDoc.employeeDepartment) {
    lines.push(`<p><strong>Department:</strong> ${requestDoc.employeeDepartment}</p>`);
  }

  lines.push('<p>Please review this request in the employee portal.</p>');
  lines.push('<p>— Vectorlytics HRMS</p>');
  return lines.join('\n');
}

function buildRequestEmailSubject(requestDoc) {
  const name = requestDoc.employeeName || requestDoc.employeeId || 'Employee';
  const typeLabel = getRequestTypeLabel(requestDoc);
  const detail =
    requestDoc.type === 'time-off'
      ? requestDoc.dateRange || ''
      : requestDoc.type === 'regularization' || requestDoc.type === 'on-duty'
        ? requestDoc.date || ''
        : '';
  return `${typeLabel} — ${name}${detail ? ` (${detail})` : ''}`;
}

function mapRequestForResponse(req) {
  return {
    id: req._id,
    emailSentAt: req.emailSentAt || null,
    emailTo: req.emailTo || [],
    emailCc: req.emailCc || [],
    emailThread: Array.isArray(req.emailThread) ? req.emailThread : [],
  };
}

async function getRequestById({ requestId, company }) {
  if (!requestId || !ObjectId.isValid(String(requestId))) {
    const err = new Error('Invalid requestId');
    err.statusCode = 400;
    throw err;
  }
  const col = await getRequestsCollection(company);
  const doc = await col.findOne({ _id: new ObjectId(String(requestId)) });
  if (!doc) {
    const err = new Error('Request not found');
    err.statusCode = 404;
    throw err;
  }
  return doc;
}

async function sendRequestEmail({ requestId, company, to, cc, sentByUserId, sentByName }) {
  if (!isGraphMailConfigured()) {
    const err = new Error('Email is not configured. Please contact your administrator.');
    err.statusCode = 503;
    throw err;
  }

  const toList = normalizeEmailList(to);
  if (!toList.length) {
    const err = new Error('At least one TO recipient is required');
    err.statusCode = 400;
    throw err;
  }

  const ccList = normalizeEmailList(cc);
  const requestDoc = await getRequestById({ requestId, company });
  const subject = buildRequestEmailSubject(requestDoc);
  const html = buildRequestEmailHtml(requestDoc);

  await sendMail({ to: toList, cc: ccList, subject, html });

  const col = await getRequestsCollection(company);
  const now = new Date();
  const threadEntry = {
    id: new ObjectId().toString(),
    kind: 'email_sent',
    authorUserId: sentByUserId ? String(sentByUserId) : null,
    authorName: sentByName || requestDoc.employeeName || 'Employee',
    authorRole: 'requester',
    message: `Email sent to ${toList.join(', ')}`,
    createdAt: now,
  };

  await col.updateOne(
    { _id: requestDoc._id },
    {
      $set: {
        emailSentAt: now,
        emailTo: toList,
        emailCc: ccList,
        updatedAt: now,
      },
      $push: { emailThread: threadEntry },
    }
  );

  return { requestId: String(requestId), emailSentAt: now, emailTo: toList, emailCc: ccList };
}

async function sendDefaultRequestEmail({ requestId, company, employeeId, sentByUserId, sentByName }) {
  if (!isGraphMailConfigured()) {
    return { skipped: true, reason: 'mail_not_configured' };
  }

  const { toEmails, ccEmails } = await resolveDefaultRecipients({ employeeId, company });
  if (!toEmails.length) {
    console.warn('[sendDefaultRequestEmail] No HR email found for company', company);
    return { skipped: true, reason: 'no_hr_recipients' };
  }

  const toLower = new Set(toEmails.map((e) => e.toLowerCase()));
  const ccDeduped = ccEmails.filter((e) => !toLower.has(e.toLowerCase()));

  return sendRequestEmail({
    requestId,
    company,
    to: toEmails,
    cc: ccDeduped,
    sentByUserId,
    sentByName,
  });
}

async function addRequestReply({ requestId, company, message, authorUserId, authorName, authorRole }) {
  const text = String(message || '').trim();
  if (!text) {
    const err = new Error('Reply message is required');
    err.statusCode = 400;
    throw err;
  }
  if (!authorUserId) {
    const err = new Error('authorUserId is required');
    err.statusCode = 400;
    throw err;
  }

  const requestDoc = await getRequestById({ requestId, company });
  const col = await getRequestsCollection(company);
  const now = new Date();
  const role = String(authorRole || 'manager').toLowerCase();

  const threadEntry = {
    id: new ObjectId().toString(),
    kind: 'reply',
    authorUserId: String(authorUserId),
    authorName: authorName || 'User',
    authorRole: role,
    message: text,
    createdAt: now,
  };

  await col.updateOne(
    { _id: requestDoc._id },
    {
      $push: { emailThread: threadEntry },
      $set: { updatedAt: now },
    }
  );

  if (isGraphMailConfigured()) {
    try {
      const usersCol = await getUsersCollection();
      const applicant = await findApplicant(usersCol, company, requestDoc.employeeId);
      const to = [];
      if (applicant?.email) to.push(applicant.email);

      const managerIds = await findDepartmentManagerUserIds(
        normalizeCompany(company),
        requestDoc.employeeDepartment
      );
      for (const mid of managerIds) {
        const m = await usersCol.findOne({
          _id: ObjectId.isValid(mid) ? new ObjectId(mid) : mid,
        });
        if (m?.email) to.push(m.email);
      }

      const author = await usersCol.findOne({
        _id: ObjectId.isValid(authorUserId) ? new ObjectId(authorUserId) : authorUserId,
      });
      const cc = author?.email ? [author.email] : [];

      const typeLabel = getRequestTypeLabel(requestDoc);
      const subject = `Re: ${typeLabel} — ${requestDoc.employeeName || requestDoc.employeeId}`;
      const html = `
        <p><strong>${threadEntry.authorName}</strong> (${role}) replied:</p>
        <p>${text.replace(/\n/g, '<br/>')}</p>
        <hr/>
        <p><em>Request: ${typeLabel}</em></p>
        <p>— Vectorlytics HRMS</p>
      `;

      if (to.length) {
        await sendMail({ to, cc, subject, html });
      }
    } catch (mailErr) {
      console.error('[addRequestReply] Email notification failed:', mailErr);
    }
  }

  return { requestId: String(requestId), reply: threadEntry };
}

module.exports = {
  getEmailRecipients,
  resolveDefaultRecipients,
  sendRequestEmail,
  sendDefaultRequestEmail,
  addRequestReply,
  getRequestById,
  mapRequestForResponse,
};
