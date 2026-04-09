function getCompanyFromRequest(req) {
  return req.query.company || req.headers['x-company'] || null;
}

// Very small in-memory cache to reduce DB load for hot polling endpoints.
const checkinStatusCache = new Map();
const CHECKIN_STATUS_CACHE_TTL_MS = 1000;

module.exports = { getCompanyFromRequest, checkinStatusCache, CHECKIN_STATUS_CACHE_TTL_MS };