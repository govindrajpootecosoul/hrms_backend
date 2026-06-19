const express = require('express');
const router = express.Router();

const c = require('../controllers/notificationsController');
const { requireAuth } = require('../../admin-portal/middlewares/auth');

router.get('/notifications', requireAuth, c.listUserNotifications);
router.post('/notifications/read-all', requireAuth, c.markAllNotificationsAsRead);
router.post('/notifications/:id/read', requireAuth, c.markNotificationAsRead);

module.exports = router;
