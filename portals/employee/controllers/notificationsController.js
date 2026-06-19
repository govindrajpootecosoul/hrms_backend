const { getCompanyFromRequest } = require('../utils/employeeContext');
const { normalizeCompany } = require('../../hrms/utils/hrmsContext');
const service = require('../services/notificationService');

function resolveCompany(req) {
  return normalizeCompany(getCompanyFromRequest(req));
}

async function listUserNotifications(req, res) {
  try {
    let company = resolveCompany(req);
    if (!company && req.auth?.company) {
      company = normalizeCompany(req.auth.company);
    }
    if (!company) {
      return res.status(400).json({ success: false, error: 'company is required' });
    }
    
    // We expect req.auth to be set by requireAuth middleware
    const recipientId = req.auth?.userId || req.auth?.id;
    if (!recipientId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: missing user details' });
    }

    const notifications = await service.listNotifications({ company, recipientId });
    
    // Format notifications for UI
    const formatted = notifications.map(n => ({
      id: n._id.toString(),
      recipientId: n.recipientId,
      senderId: n.senderId,
      senderName: n.senderName,
      title: n.title,
      message: n.message,
      type: n.type,
      referenceId: n.referenceId,
      audience: n.audience || null,
      isRead: n.isRead,
      createdAt: n.createdAt
    }));

    res.json({
      success: true,
      data: formatted
    });
  } catch (error) {
    console.error('[NotificationsController] listUserNotifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function markNotificationAsRead(req, res) {
  try {
    const company = resolveCompany(req);
    if (!company) {
      return res.status(400).json({ success: false, error: 'company is required' });
    }

    const recipientId = req.auth?.userId || req.auth?.id;
    if (!recipientId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: missing user details' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Notification ID is required' });
    }

    const success = await service.markAsRead({ company, recipientId, notificationId: id });
    res.json({
      success,
      message: success ? 'Notification marked as read' : 'Notification not found or already read'
    });
  } catch (error) {
    console.error('[NotificationsController] markNotificationAsRead error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function markAllNotificationsAsRead(req, res) {
  try {
    const company = resolveCompany(req);
    if (!company) {
      return res.status(400).json({ success: false, error: 'company is required' });
    }

    const recipientId = req.auth?.userId || req.auth?.id;
    if (!recipientId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: missing user details' });
    }

    const success = await service.markAllAsRead({ company, recipientId });
    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('[NotificationsController] markAllNotificationsAsRead error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = {
  listUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
};
