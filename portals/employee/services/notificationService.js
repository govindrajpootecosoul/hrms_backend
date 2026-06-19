const { getDb, getEmployeePortalDb, getUsersCollection, LOGIN_DB_NAME } = require('../../../config/mongo');
const { ObjectId } = require('mongodb');
const { normalizeCompany, companyQuery, escapeRe } = require('../../hrms/utils/hrmsContext');

const DEPARTMENT_MANAGERS_COLLECTION = 'department_managers';
const NOTIFICATIONS_COLLECTION = 'portal_notifications';

async function getDepartmentManagersCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(DEPARTMENT_MANAGERS_COLLECTION);
}

async function getNotificationsCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(NOTIFICATIONS_COLLECTION);
}

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

function companyFilterForNotifications(company) {
  const normalized = normalizeCompany(company);
  if (!normalized) return {};
  const lc = normalized.toLowerCase();
  if (lc === 'thrive') return { company: { $regex: /^thrive$/i } };
  if (lc.includes('ecosoul') || lc.includes('eco soul')) return { company: { $regex: /ecosoul/i } };
  return { company: { $regex: new RegExp(`^${escapeRe(normalized)}$`, 'i') } };
}

function employeeIdQuery(employeeId) {
  const empId = String(employeeId || '').trim();
  if (!empId) return null;
  return {
    $or: [
      { employeeId: empId },
      { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
      { email: new RegExp(`^${escapeRe(empId)}(@|$)`, 'i') },
    ],
  };
}

function getTitleForRequest(requestDoc) {
  const type = requestDoc.type;
  if (type === 'time-off') {
    if (requestDoc.leaveType === 'Work From Home') {
      return 'New WFH Request';
    }
    return 'New Leave Request';
  } else if (type === 'regularization') {
    return 'New Regularization Request';
  }
  return 'New Attendance Request';
}

function getMessageForRequest(requestDoc, applicantName) {
  const type = requestDoc.type;
  const name = applicantName || requestDoc.employeeName || 'An employee';
  if (type === 'time-off') {
    if (requestDoc.leaveType === 'Work From Home') {
      return `${name} has requested Work From Home.`;
    }
    return `${name} has requested Leave (${requestDoc.leaveType || 'Time Off'}).`;
  } else if (type === 'regularization') {
    return `${name} has requested Attendance Regularization for ${requestDoc.date || 'specified date'}.`;
  }
  return `${name} has submitted an attendance/leave request.`;
}

function getDecisionMessage(requestDoc, action, decidedByName, approverRole) {
  const type = requestDoc.type;
  const act = action === 'approve' ? 'approved' : 'rejected';
  const name = String(decidedByName || '').trim();
  const role = String(approverRole || '').toLowerCase();
  let decBy = name || 'Manager/HR';
  if (!name) {
    decBy = role === 'hr' ? 'HR' : 'Department Manager';
  }
  if (type === 'time-off') {
    if (requestDoc.leaveType === 'Work From Home') {
      return `Your Work From Home request has been ${act} by ${decBy}.`;
    }
    return `Your Leave request (${requestDoc.leaveType || 'Time Off'}) has been ${act} by ${decBy}.`;
  } else if (type === 'regularization') {
    return `Your Attendance Regularization request for ${requestDoc.date || 'specified date'} has been ${act} by ${decBy}.`;
  }
  return `Your attendance/leave request has been ${act} by ${decBy}.`;
}

async function findApplicant(usersCol, company, employeeId) {
  const idQuery = employeeIdQuery(employeeId);
  if (!idQuery) return null;

  let applicant = await usersCol.findOne({ ...companyQuery(company), ...idQuery });
  if (!applicant) {
    applicant = await usersCol.findOne(idQuery);
  }
  return applicant;
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

  const withHrmsPortal = await usersCol.find({
    ...baseQuery,
    portals: { $regex: /hrms/i },
  }).toArray();

  const admins = withHrmsPortal.length
    ? withHrmsPortal
    : await usersCol.find(baseQuery).toArray();

  return admins.map((u) => u._id.toString());
}

/**
 * Creates a notification in the login DB (single source of truth).
 */
async function createNotification({ company, recipientId, senderId, senderName, title, message, type, referenceId, audience }) {
  if (!company || !recipientId) return null;
  try {
    const col = await getNotificationsCollection();
    const normalizedCompany = normalizeCompany(company);
    const doc = {
      company: normalizedCompany,
      recipientId: String(recipientId),
      senderId: senderId ? String(senderId) : null,
      senderName: senderName || null,
      title,
      message,
      type,
      referenceId: referenceId ? String(referenceId) : null,
      audience: audience || null,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await col.insertOne(doc);
    return result.insertedId;
  } catch (error) {
    console.error('[NotificationService] Error creating notification:', error);
    return null;
  }
}

/**
 * Triggers a notification to Department Manager and HRMS Admin (for HR dept) when a request is submitted.
 */
async function triggerRequestNotification({ company, requestDoc, requestId }) {
  try {
    if (!company || !requestDoc) return;
    const usersCol = await getUsersCollection();
    const normalizedCompany = normalizeCompany(company);

    const applicant = await findApplicant(usersCol, normalizedCompany, requestDoc.employeeId);
    const applicantUserId = applicant?._id?.toString() || null;
    const applicantDept = normalizeDept(applicant?.department || requestDoc.employeeDepartment);

    if (!applicantDept) {
      console.warn(
        `[NotificationService] No department for employee ${requestDoc.employeeId} (company: ${normalizedCompany}). Assign department on user profile.`
      );
    }

    const managerUserIds = applicantDept
      ? await findDepartmentManagerUserIds(normalizedCompany, applicantDept)
      : [];

    let recipientIds = [...managerUserIds];

    if (isHrDepartment(applicantDept)) {
      const hrmsAdminIds = await findHrmsAdminUserIds(usersCol, normalizedCompany);
      recipientIds = Array.from(new Set([...recipientIds, ...hrmsAdminIds]));
    }

    recipientIds = Array.from(new Set(recipientIds)).filter((id) => id && id !== applicantUserId);

    if (!recipientIds.length) {
      console.warn(
        `[NotificationService] No recipients for request ${requestId}. dept="${applicantDept || ''}", managersConfigured=${managerUserIds.length}, company="${normalizedCompany}"`
      );
      return;
    }

    console.log(
      `[NotificationService] Sending notification to ${recipientIds.length} recipients for request ${requestId} (dept: ${applicantDept || 'unknown'})`
    );

    const title = getTitleForRequest(requestDoc);
    const message = getMessageForRequest(requestDoc, applicant?.name);

    for (const recipientId of recipientIds) {
      const recipientUser = await usersCol.findOne({
        _id: ObjectId.isValid(recipientId) ? new ObjectId(recipientId) : recipientId,
      });
      const isHrmsAdminRecipient =
        isHrDepartment(applicantDept) &&
        ['admin', 'superadmin'].includes(String(recipientUser?.role || '').toLowerCase());

      await createNotification({
        company: normalizedCompany,
        recipientId,
        senderId: applicantUserId,
        senderName: applicant?.name || requestDoc.employeeName || 'Employee',
        title,
        message,
        type:
          requestDoc.type === 'time-off' && requestDoc.leaveType === 'Work From Home'
            ? 'wfh_request'
            : `${requestDoc.type}_request`,
        referenceId: String(requestId),
        audience: isHrmsAdminRecipient ? 'hrms_admin' : 'employee_portal',
      });
    }
  } catch (error) {
    console.error('[NotificationService] Error triggering request notification:', error);
  }
}

/**
 * Triggers a notification to the applicant when their request is approved/rejected.
 */
async function triggerDecisionNotification({ company, requestDoc, action, decidedByUserId, decidedByName, approverRole }) {
  try {
    if (!company || !requestDoc) return;
    const usersCol = await getUsersCollection();
    const normalizedCompany = normalizeCompany(company);

    const applicant = await findApplicant(usersCol, normalizedCompany, requestDoc.employeeId);
    const applicantUserId = applicant?._id?.toString() || null;

    if (!applicantUserId) {
      console.warn(`[NotificationService] No user record found for employeeId: ${requestDoc.employeeId} in company: ${normalizedCompany}`);
      return;
    }

    const title = `Request ${action === 'approve' ? 'Approved' : 'Rejected'}`;
    const message = getDecisionMessage(requestDoc, action, decidedByName, approverRole);

    await createNotification({
      company: normalizedCompany,
      recipientId: applicantUserId,
      senderId: decidedByUserId || null,
      senderName: decidedByName || 'Manager/HR',
      title,
      message,
      type: `request_${action}d`,
      referenceId: String(requestDoc._id || requestDoc.id),
      audience: 'employee_portal',
    });
  } catch (error) {
    console.error('[NotificationService] Error triggering decision notification:', error);
  }
}

async function readLegacyNotifications(company, recipientId) {
  try {
    const db = await getEmployeePortalDb(company);
    return db.collection('notifications').find({ recipientId: String(recipientId) }).sort({ createdAt: -1 }).toArray();
  } catch {
    return [];
  }
}

/**
 * Fetch all notifications for a given user.
 */
async function listNotifications({ company, recipientId }) {
  if (!recipientId) return [];
  const normalizedCompany = normalizeCompany(company);
  const rid = String(recipientId);

  const col = await getNotificationsCollection();
  const primaryQuery = {
    recipientId: rid,
    ...(normalizedCompany ? companyFilterForNotifications(normalizedCompany) : {}),
  };

  let results = await col.find(primaryQuery).sort({ createdAt: -1 }).toArray();

  if (!results.length && normalizedCompany) {
    const legacy = await readLegacyNotifications(normalizedCompany, rid);
    if (legacy.length) results = legacy;
  }

  return results;
}

/**
 * Mark a single notification as read.
 */
async function markAsRead({ company, recipientId, notificationId }) {
  if (!recipientId || !notificationId) return false;
  const col = await getNotificationsCollection();
  const normalizedCompany = normalizeCompany(company);
  const rid = String(recipientId);

  const query = {
    _id: ObjectId.isValid(notificationId) ? new ObjectId(notificationId) : notificationId,
    recipientId: rid,
    ...(normalizedCompany ? companyFilterForNotifications(normalizedCompany) : {}),
  };

  let result = await col.updateOne(query, {
    $set: { isRead: true, updatedAt: new Date() },
  });

  if (!result.modifiedCount && normalizedCompany) {
    try {
      const legacyDb = await getEmployeePortalDb(normalizedCompany);
      result = await legacyDb.collection('notifications').updateOne(
        {
          _id: ObjectId.isValid(notificationId) ? new ObjectId(notificationId) : notificationId,
          recipientId: rid,
        },
        { $set: { isRead: true, updatedAt: new Date() } }
      );
    } catch {
      // ignore
    }
  }

  return result.modifiedCount > 0;
}

/**
 * Mark all notifications for a recipient as read.
 */
async function markAllAsRead({ company, recipientId }) {
  if (!recipientId) return false;
  const col = await getNotificationsCollection();
  const normalizedCompany = normalizeCompany(company);
  const rid = String(recipientId);
  const filter = {
    recipientId: rid,
    isRead: false,
    ...(normalizedCompany ? companyFilterForNotifications(normalizedCompany) : {}),
  };

  const result = await col.updateMany(filter, {
    $set: { isRead: true, updatedAt: new Date() },
  });

  if (normalizedCompany) {
    try {
      const legacyDb = await getEmployeePortalDb(normalizedCompany);
      await legacyDb.collection('notifications').updateMany(
        { recipientId: rid, isRead: false },
        { $set: { isRead: true, updatedAt: new Date() } }
      );
    } catch {
      // ignore
    }
  }

  return result.modifiedCount > 0;
}

module.exports = {
  createNotification,
  triggerRequestNotification,
  triggerDecisionNotification,
  listNotifications,
  markAsRead,
  markAllAsRead,
};
