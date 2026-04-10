const { getTenantCompanyFromRequest } = require('../../../config/tenantCompany');

/** Same as global tenant resolver (body, query, headers, JWT). */
function getCompanyFromRequest(req) {
  return getTenantCompanyFromRequest(req);
}

// Very small in-memory cache to reduce DB load for hot polling endpoints.
const checkinStatusCache = new Map();
const CHECKIN_STATUS_CACHE_TTL_MS = 1000;

module.exports = {
  getCompanyFromRequest,
  checkinStatusCache,
  CHECKIN_STATUS_CACHE_TTL_MS,
};
