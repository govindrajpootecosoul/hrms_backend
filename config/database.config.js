require('dotenv').config();

/**
 * CENTRALIZED DATABASE CONFIGURATION
 * 
 * ⚠️ IMPORTANT: Change MongoDB connection details here and it will update across ALL portals
 * 
 * This file is the single source of truth for database connections.
 * All MongoDB connections in the project should use this configuration.
 * 
 * To change MongoDB connection, edit the values below.
 */

// ============================================
// MONGODB CONFIGURATION
// ============================================
// Change these values to update MongoDB connection across the entire project
const mongoPortRaw = process.env.MONGO_PORT;
const mongoPortParsed =
  mongoPortRaw != null && String(mongoPortRaw).trim() !== ''
    ? parseInt(mongoPortRaw, 10)
    : NaN;

const MONGODB_CONFIG = {
  host: process.env.MONGO_HOST || null,
  port: mongoPortParsed,
  uri: process.env.MONGO_URI || process.env.MONGODB_URI || null,
  
  // Database Names
  // Base database names - will be prefixed with company name (e.g., ecosoul_asset_tracker, thrive_asset_tracker)
  // Format: {company}_{base_database_name}
  // Examples:
  //   - Ecosoul: ecosoul_asset_tracker, ecosoul_hrms, ecosoul_finance, ecosoul_query_tracker, ecosoul_employee
  //   - Thrive: thrive_asset_tracker, thrive_hrms, thrive_finance, thrive_query_tracker, thrive_employee
  databases: {
    // Align with frontend env: same base name as old direct-Mongo client (MONGO_DB_NAME / MONGODB_DB_NAME)
    assetTracker:
      process.env.ASSET_TRACKER_DB_NAME ||
      process.env.MONGODB_ASSET_DB_NAME ||
      'asset_tracker',
    login: process.env.MONGO_LOGIN_DB_NAME || 'Employees_List', // Shared database (not company-specific)
    employee: process.env.MONGO_DB_NAME || (process.env.NODE_ENV === 'production' ? 'hrms_prod' : 'Employee'), // Results in: ecosoul_Employee, thrive_Employee
    queryTracker: process.env.QUERY_TRACKER_DB_NAME || 'query_tracker', // Results in: ecosoul_query_tracker, thrive_query_tracker
    hrms: process.env.HRMS_DB_NAME || 'hrms', // Results in: ecosoul_hrms, thrive_hrms
    finance: process.env.FINANCE_DB_NAME || 'finance', // Results in: ecosoul_finance, thrive_finance
  },
  
  // Collection Names
  collections: {
    assets: 'assets',
    users: process.env.MONGO_USERS_COLLECTION || 'users',
  },
  
  // Connection Options
  options: {
    maxPoolSize: 10,
    connectTimeoutMS: 15008,
    serverSelectionTimeoutMS: 15008,
    socketTimeoutMS: 45008,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    retryReads: true,
  },
};

if (
  !MONGODB_CONFIG.uri &&
  (!MONGODB_CONFIG.host || Number.isNaN(MONGODB_CONFIG.port))
) {
  throw new Error(
    'MongoDB: set MONGO_URI or MONGODB_URI in .env, or set both MONGO_HOST and MONGO_PORT'
  );
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get MongoDB connection URI
 * @param {string} databaseName - Optional database name to append
 * @returns {string} MongoDB connection URI
 */
function getMongoUri(databaseName = null) {
  // If full URI is provided, use it
  if (MONGODB_CONFIG.uri) {
    if (databaseName) {
      const separator = MONGODB_CONFIG.uri.endsWith('/') ? '' : '/';
      return `${MONGODB_CONFIG.uri}${separator}${databaseName}`;
    }
    return MONGODB_CONFIG.uri;
  }
  
  // Construct URI from host and port
  const baseUri = `mongodb://${MONGODB_CONFIG.host}:${MONGODB_CONFIG.port}`;
  return databaseName ? `${baseUri}/${databaseName}` : baseUri;
}

/**
 * Get company name from email domain
 * @param {string} email - User email address
 * @returns {string|null} Company name ('Thrive' or 'Ecosoul Home') or null
 */
function getCompanyFromEmail(email) {
  if (!email) return null;
  const emailLower = email.toLowerCase();
  if (emailLower.endsWith('@thrivebrands.ai')) {
    return 'Thrive';
  } else if (emailLower.endsWith('@ecosoulhome.com')) {
    return 'Ecosoul Home';
  }
  return null;
}

/**
 * Canonical Mongo company prefix (must match existing DBs — see DATABASE_STRUCTURE.md).
 * "Ecosoul Home" → ecosoul_asset_tracker, not ecosoul_home_asset_tracker.
 */
function normalizeCompanyKey(company) {
  if (!company || typeof company !== 'string') return '';
  const t = company.trim().toLowerCase();
  if (t.includes('thrive')) return 'thrive';
  if (t.includes('ecosoul') || t.includes('eco soul')) return 'ecosoul';
  return company.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Get company-specific database name
 * @param {string} module - Module name: 'assetTracker', 'hrms', 'finance', 'queryTracker', 'employee'
 * @param {string} company - Company name: 'Thrive' or 'Ecosoul Home'
 * @returns {string} Company-specific database name
 * 
 * Examples:
 *   - getCompanyDatabaseName('assetTracker', 'Ecosoul Home') => 'ecosoul_asset_tracker'
 *   - getCompanyDatabaseName('hrms', 'Thrive') => 'thrive_hrms'
 *   - getCompanyDatabaseName('finance', 'Ecosoul Home') => 'ecosoul_finance'
 *   - getCompanyDatabaseName('queryTracker', 'Thrive') => 'thrive_query_tracker'
 *   - getCompanyDatabaseName('employee', 'Ecosoul Home') => 'ecosoul_Employee'
 * 
 * Note: 'login' module always returns 'Employees_List' (shared database)
 */
function getCompanyDatabaseName(module = 'assetTracker', company = null) {
  // Login database is shared and not company-specific
  if (module === 'login') {
    return MONGODB_CONFIG.databases.login;
  }
  
  const baseDbName = MONGODB_CONFIG.databases[module] || MONGODB_CONFIG.databases.assetTracker;
  
  // If no company specified, return base database name
  if (!company) {
    return baseDbName;
  }
  
  const normalizedCompany = normalizeCompanyKey(company);
  
  // Return company-specific database name: {company}_{base_database_name}
  return `${normalizedCompany}_${baseDbName}`;
}

/**
 * Get database name for a specific portal/module
 * @param {string} module - Module name: 'assetTracker', 'login', 'employee', 'queryTracker', 'hrms', 'finance'
 * @returns {string} Database name
 */
function getDatabaseName(module = 'assetTracker') {
  return MONGODB_CONFIG.databases[module] || MONGODB_CONFIG.databases.assetTracker;
}

/**
 * Get collection name
 * @param {string} collection - Collection name: 'assets', 'users'
 * @returns {string} Collection name
 */
function getCollectionName(collection = 'assets') {
  return MONGODB_CONFIG.collections[collection] || collection;
}

// Export configuration
module.exports = {
  MONGODB_CONFIG,
  getMongoUri,
  getDatabaseName,
  getCompanyDatabaseName,
  getCompanyFromEmail,
  getCollectionName,
};

