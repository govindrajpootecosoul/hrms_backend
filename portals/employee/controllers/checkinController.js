const { connectMongo } = require('../../../config/mongo');
const { getCompanyFromRequest } = require('../utils/employeeContext');
const { checkinStatusCache, CHECKIN_STATUS_CACHE_TTL_MS } = require('../utils/employeeContext');
const { checkinEmployee, checkoutEmployee, getTodayStatus, getHistory } = require('../services/checkinService');

async function checkin(req, res) {
  try {
    await connectMongo();
    const { employeeId } = req.body;
    const company = getCompanyFromRequest(req);

    const data = await checkinEmployee({ employeeId, company });
    res.json({ success: true, message: 'Checked in successfully', data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkin] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function checkout(req, res) {
  try {
    await connectMongo();
    const { employeeId } = req.body;
    const company = getCompanyFromRequest(req);

    const data = await checkoutEmployee({ employeeId, company });
    res.json({ success: true, message: 'Checked out successfully', data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkout] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getCheckinStatus(req, res) {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId;
    const company = getCompanyFromRequest(req);

    const data = await getTodayStatus({
      employeeId,
      company,
      cache: { map: checkinStatusCache, ttlMs: CHECKIN_STATUS_CACHE_TTL_MS },
    });

    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkin/status] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getCheckinHistory(req, res) {
  try {
    await connectMongo();
    const employeeId = req.query.employeeId;
    const limit = parseInt(req.query.limit, 10) || 30;
    const company = getCompanyFromRequest(req);

    const data = await getHistory({ employeeId, company, limit });
    res.json({ success: true, data });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error('[checkin/history] Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

module.exports = { checkin, checkout, getCheckinStatus, getCheckinHistory };