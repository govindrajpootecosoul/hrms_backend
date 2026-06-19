const { getDb, getEmployeePortalDb, getUsersCollection, LOGIN_DB_NAME } = require('../../../config/mongo');
const { ObjectId } = require('mongodb');
const { normalizeCompany, companyQuery, escapeRe } = require('../../hrms/utils/hrmsContext');

const DEPARTMENT_MANAGERS_COLLECTION = 'department_managers';

async function getDepartmentManagersCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(DEPARTMENT_MANAGERS_COLLECTION);
}

function normalizeDept(v) {
  return String(v || '').trim();
}

function isHrDepartment(dept) {
  const d = normalizeDept(dept).toLowerCase();
  return d === 'hr' || d === 'human resources' || d.startsWith('hr ') || d.includes('human resource');
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

function getDecisionMessage(requestDoc, action, decidedByName) {
  const type = requestDoc.type;
  const act = action === 'approve' ? 'approved' : 'rejected';
  const decBy = decidedByName || 'Manager/HR';
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
  const empId = String(employeeId || '').trim();
  if (!empId) return null;
  return usersCol.findOne({
    ...companyQuery(company),
    $or: [
      { employeeId: empId },
      { employeeId: new RegExp(`^${escapeRe(empId)}$`, 'i') },
      { email: new RegExp(`^${escapeRe(empId)}(@|$)`, 'i') },
    ],
  });
}

async function findDepartmentManagerUserIds(company, department) {
  const dept = normalizeDept(department);
  if (!dept) return [];

  const managersCol = await getDepartmentManagersCollection();
  const docs = await managersCol.find({
    ...companyQuery(company),
    department: { $regex: new RegExp(`^${escapeRe(dept)}$`, 'i') },
  }).toArray();

  const ids = [];
  for (const doc of docs) {
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
 * Creates a notification in the company-specific database.
 */
async function createNotification({ company, recipientId, senderId, senderName, title, message, type, referenceId, audience }) {
  if (!company || !recipientId) return null;
  try {
    const db = await getEmployeePortalDb(company);
    const col = db.collection('notifications');
    const doc = {
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

    const applicant = await findApplicant(usersCol, company, requestDoc.employeeId);
    const applicantUserId = applicant?._id?.toString() || null;
    const applicantDept = normalizeDept(applicant?.department || requestDoc.employeeDepartment);

    if (!applicantDept) {
      console.warn(`[NotificationService] No department found for employee: ${requestDoc.employeeId}. Cannot target managers.`);
    }

    const managerUserIds = applicantDept
      ? await findDepartmentManagerUserIds(company, applicantDept)
      : [];

    let recipientIds = [...managerUserIds];

    if (isHrDepartment(applicantDept)) {
      const hrmsAdminIds = await findHrmsAdminUserIds(usersCol, company);
      recipientIds = Array.from(new Set([...recipientIds, ...hrmsAdminIds]));
    }

    recipientIds = Array.from(new Set(recipientIds)).filter((id) => id && id !== applicantUserId);

    console.log(
      `[NotificationService] Sending notification to ${recipientIds.length} recipients for request ${requestId} (dept: ${applicantDept || 'unknown'}, hrDept: ${isHrDepartment(applicantDept)})`
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
        company,
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
async function triggerDecisionNotification({ company, requestDoc, action, decidedByUserId, decidedByName }) {
  try {
    if (!company || !requestDoc) return;
    const usersCol = await getUsersCollection();

    const applicant = await findApplicant(usersCol, company, requestDoc.employeeId);
    const applicantUserId = applicant?._id?.toString() || null;

    if (!applicantUserId) {
      console.warn(`[NotificationService] No user record found for employeeId: ${requestDoc.employeeId} in company: ${company}`);
      return;
    }

    const title = `Request ${action === 'approve' ? 'Approved' : 'Rejected'}`;
    const message = getDecisionMessage(requestDoc, action, decidedByName);

    console.log(`[NotificationService] Sending decision notification to applicant user: ${applicantUserId} (employeeId: ${requestDoc.employeeId})`);

    await createNotification({
      company,
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

/**
 * Fetch all notifications for a given user.
 */
async function listNotifications({ company, recipientId }) {
  if (!company || !recipientId) return [];
  const db = await getEmployeePortalDb(company);
  const col = db.collection('notifications');
  return col.find({ recipientId: String(recipientId) }).sort({ createdAt: -1 }).toArray();
}

/**
 * Mark a single notification as read.
 */
async function markAsRead({ company, recipientId, notificationId }) {
  if (!company || !recipientId || !notificationId) return false;
  const db = await getEmployeePortalDb(company);
  const col = db.collection('notifications');

  const query = {
    _id: ObjectId.isValid(notificationId) ? new ObjectId(notificationId) : notificationId,
    recipientId: String(recipientId),
  };

  const result = await col.updateOne(query, {
    $set: { isRead: true, updatedAt: new Date() },
  });
  return result.modifiedCount > 0;
}

/**
 * Mark all notifications for a recipient as read.
 */
async function markAllAsRead({ company, recipientId }) {
  if (!company || !recipientId) return false;
  const db = await getEmployeePortalDb(company);
  const col = db.collection('notifications');

  const result = await col.updateMany(
    { recipientId: String(recipientId), isRead: false },
    { $set: { isRead: true, updatedAt: new Date() } }
  );
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
