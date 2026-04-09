const { connectMongo, getDb, getEmployeePortalDb } = require('../../../config/mongo');
const { getCompanyDatabaseName } = require('../../../config/database.config');

/**
 * Get company from request (query parameter, route param, or header)
 * Supports:
 * - ?company=Thrive
 * - ?companyId=2 (normalized later to 'Thrive')
 * - x-company header
 */
function getCompanyFromRequest(req) {
  return (
    req.query.company ||
    req.query.companyId ||
    req.headers['x-company'] ||
    null
  );
}

/**
 * Normalize company value to canonical name ('Ecosoul Home' or 'Thrive').
 * Returns null if missing or invalid (multi-tenant: never return other company's data).
 */
function normalizeCompany(value) {
  if (value == null || value === '' || value === 'undefined') return null;
  const raw = String(value).trim();
  if (!raw || raw === 'all') return null;
  const lc = raw.toLowerCase();
  if (lc === '1' || lc === 'ecosoul' || lc === 'ecosoulhome' || lc === 'eco soul' || lc === 'ecosoul home') return 'Ecosoul Home';
  if (lc === '2' || lc === 'thrive' || lc === 'thrive brands' || lc === 'thrivebrands') return 'Thrive';
  return raw;
}

/**
 * Require company for company-scoped routes. Sends 400 if missing.
 * @returns {string|null} Normalized company name or null (response already sent)
 */
function requireCompany(req, res) {
  const company = normalizeCompany(getCompanyFromRequest(req));
  if (!company) {
    res.status(400).json({ success: false, error: 'Company is required. Please ensure your company is selected.' });
    return null;
  }
  return company;
}

/** Fixed recruiter names for "All Recruiters" dropdown in recruitment */
const RECRUITMENT_RECRUITER_NAMES = ['Priyanka', 'Charu', 'Megha', 'Harshita', 'Deepali'];

/**
 * Get HRMS database (company-specific or all data for admin)
 * For HRMS Admin Portal, if company is null or 'all', return default database with all data
 */
async function getHrmsDb(company = null) {
  await connectMongo();
  // For HRMS Admin Portal - show all data if company is null or 'all'
  if (!company || company === 'all' || company === 'undefined') {
    const { getDatabaseName } = require('../../../config/database.config');
    return (await getDb(getDatabaseName('hrms')));
  }
  // Note: Ecosoul HRMS data is stored in legacy DB name "ecosoul_home_hrms".
  // Thrive continues using canonical DB name from getCompanyDatabaseName().
  const isEcosoul = String(company).toLowerCase().includes('ecosoul');
  const dbName = isEcosoul ? 'ecosoul_home_hrms' : getCompanyDatabaseName('hrms', company);
  const { MongoClient } = require('mongodb');
  const { getMongoUri } = require('../../../config/app.config');
  const uri = getMongoUri();
  const client = new MongoClient(uri);
  await client.connect();
  return client.db(dbName);
}

/**
 * Get all HRMS databases for aggregating data across companies
 * Optimized for fast loading - uses parallel queries
 */
async function getAllHrmsDbs() {
  await connectMongo();
  const { getDatabaseName } = require('../../../config/database.config');
  
  // Get default HRMS database
  const defaultDb = await getDb(getDatabaseName('hrms'));
  
  // Try to get company-specific databases in parallel for faster loading
  const companyNames = ['Ecosoul Home', 'Thrive'];
  const dbPromises = companyNames.map(async (companyName) => {
    try {
      const dbName = companyName.toLowerCase().includes('ecosoul')
        ? 'ecosoul_home_hrms'
        : getCompanyDatabaseName('hrms', companyName);
      const { MongoClient } = require('mongodb');
      const { getMongoUri } = require('../../../config/app.config');
      const uri = getMongoUri();
      const client = new MongoClient(uri);
      await client.connect();
      const db = client.db(dbName);
      
      // Quick check if database has data
      const recruitmentCol = db.collection('recruitment');
      const count = await recruitmentCol.countDocuments({}, { limit: 1 });
      if (count > 0) {
        return db;
      }
      await client.close();
      return null;
    } catch (err) {
      // Database doesn't exist or error, skip
      return null;
    }
  });
  
  const companyDbs = await Promise.all(dbPromises);
  const dbs = [defaultDb, ...companyDbs.filter(db => db !== null)];
  
  return dbs;
}

/**
 * Get Employee database (company-specific) - for accessing attendance requests
 */
async function getEmployeeDbForHrms(company = null) {
  await connectMongo();
  if (!company) {
    const { getDatabaseName } = require('../../../config/database.config');
    return (await getDb(getDatabaseName('employee')));
  }
  return await getEmployeePortalDb(company);
}

module.exports = {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  RECRUITMENT_RECRUITER_NAMES,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
};
