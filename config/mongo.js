const { MongoClient } = require('mongodb');
const { config, getMongoUri } = require('./app.config');
const { MONGODB_CONFIG, getDatabaseName } = require('./database.config');

// MongoDB connection URI - supports both dev and production
// If MONGO_URI is set, use it. Otherwise, use non-authenticated connection
// (Authentication can be enabled later via environment variable)
const MONGO_URI = getMongoUri();

const LOGIN_DB_NAME = config.mongodb.loginDbName;
const EMPLOYEE_DB_NAME = config.mongodb.employeeDbName;
const USERS_COLLECTION = config.mongodb.usersCollection;

// Portal configuration - defines database and collections for each portal
const PORTAL_CONFIG = {
  hrms: {
    database: getDatabaseName('hrms'),
    collections: ['employees', 'attendance', 'leaves', 'departments', 'designations', 'recruitment', 'leave_policies']
  },
  assets: {
    database: getDatabaseName('assetTracker'),
    collections: ['assets', 'asset_categories', 'asset_assignments', 'asset_history', 'companies']
  },
  finance: {
    database: getDatabaseName('finance'),
    collections: ['invoices', 'transactions', 'expenses', 'budgets', 'financial_reports']
  },
  employee: {
    database: getDatabaseName('employee'),
    collections: ['dashboard', 'requests', 'announcements', 'documents', 'payroll', 'attendance_requests', 'employee_checkins']
  },
  'query-tracker': {
    database: getDatabaseName('queryTracker'),
    collections: ['queries', 'users', 'reports'] // Note: query-tracker has its own setup
  }
};

let client;
let loginDb;
let employeeDb;
// Cache for arbitrary database handles (asset-tracker, hrms, etc.)
const dbCache = new Map();
let isConnecting = false;

// Check if client is connected and topology is open
function isClientConnected() {
  return client && client.topology && client.topology.isConnected();
}

// Reconnect if connection is closed
async function ensureConnection() {
  if (!client || !isClientConnected()) {
    if (isConnecting) {
      // Wait for ongoing connection attempt
      let attempts = 0;
      while (isConnecting && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      if (isClientConnected()) return;
    }
    
    isConnecting = true;
    try {
      // Close existing client if it exists
      if (client) {
        try {
          await client.close();
        } catch (err) {
          // Ignore close errors
        }
      }
      
      // Reset database references
      loginDb = null;
      employeeDb = null;
      dbCache.clear();
      
      // Create new connection with smart authentication handling
      let connectionUri = MONGO_URI;
      
      // Check if URI contains credentials but we should try without first
      // If MONGO_URI env var is explicitly set, use it as-is
      // Otherwise, use non-auth connection
      const hasExplicitUri = process.env.MONGO_URI;
      const hasCredentials = connectionUri.includes('@') && connectionUri.includes(':');
      
      // If credentials are in URI but not explicitly set via env, try without auth first
      if (hasCredentials && !hasExplicitUri) {
        // Remove credentials from URI
        connectionUri = connectionUri.replace(/mongodb:\/\/[^@]+@/, 'mongodb://');
      }
      
      try {
        client = new MongoClient(connectionUri, {
          maxPoolSize: 10,
          connectTimeoutMS: 15008,
          serverSelectionTimeoutMS: 15008,
          socketTimeoutMS: 45008,
          heartbeatFrequencyMS: 10000,
          retryWrites: true,
          retryReads: true,
        });
        
        await client.connect();
        const authStatus = hasCredentials && hasExplicitUri ? ' (with authentication)' : ' (without authentication)';
        console.log(`✅ [mongo] Connected to MongoDB${authStatus}`);
      } catch (connectError) {
        // If connection fails and we have credentials in original URI, try with credentials
        if (hasCredentials && !hasExplicitUri && connectError.message && !connectError.message.includes('Authentication')) {
          console.warn(`⚠️  [mongo] Connection failed, trying with authentication...`);
          
          if (client) {
            try {
              await client.close();
            } catch (e) {}
          }
          
          // Try with original URI that has credentials
          const authUri = MONGO_URI;
          try {
            client = new MongoClient(authUri, {
              maxPoolSize: 10,
              connectTimeoutMS: 10000,
              serverSelectionTimeoutMS: 10000,
              socketTimeoutMS: 45008,
              heartbeatFrequencyMS: 10000,
            });
            
            await client.connect();
            console.log(`✅ [mongo] Connected to MongoDB (with authentication)`);
          } catch (authError) {
            console.error(`❌ [mongo] Connection failed: ${authError.message}`);
            throw authError;
          }
        } else {
          console.error(`❌ [mongo] Connection failed: ${connectError.message}`);
          throw connectError;
        }
      }
    } catch (err) {
      console.error(`❌ [mongo] Reconnection failed: ${err.message}`);
      throw err;
    } finally {
      isConnecting = false;
    }
  }
}

async function connectMongo(dbName = null) {
  // Ensure connection is active
  await ensureConnection();

  const targetDb = dbName || EMPLOYEE_DB_NAME;
  
  if (targetDb === LOGIN_DB_NAME) {
    if (!loginDb) {
      loginDb = client.db(LOGIN_DB_NAME);
      console.log(`[mongo] Using login database: ${LOGIN_DB_NAME}`);
    }
    return loginDb;
  } else {
    // If a specific DB name was provided (e.g. thrive_asset_tracker), use it.
    if (dbName && dbName !== EMPLOYEE_DB_NAME) {
      if (!dbCache.has(dbName)) {
        dbCache.set(dbName, client.db(dbName));
        console.log(`[mongo] Using database: ${dbName}`);
      }
      return dbCache.get(dbName);
    }

    if (!employeeDb) {
      employeeDb = client.db(EMPLOYEE_DB_NAME);
      console.log(`[mongo] Using employee database: ${EMPLOYEE_DB_NAME}`);
    }
    return employeeDb;
  }
}

/**
 * Get company-specific database for employee portal
 * @param {string} company - Company name: 'Thrive' or 'Ecosoul Home'
 * @returns {Promise<Db>} Company-specific database
 */
async function getEmployeePortalDb(company = null) {
  await ensureConnection();
  
  if (!company) {
    // Default to base employee database if no company specified
    if (!employeeDb) {
      employeeDb = client.db(EMPLOYEE_DB_NAME);
    }
    return employeeDb;
  }
  
  // Get company-specific database name
  const { getCompanyDatabaseName } = require('./database.config');
  const companyDbName = getCompanyDatabaseName('employee', company);
  
  // Return company-specific database
  return client.db(companyDbName);
}

async function getDb(dbName = null) {
  // Ensure connection before getting database
  await ensureConnection();
  
  const targetDb = dbName || EMPLOYEE_DB_NAME;
  
  if (targetDb === LOGIN_DB_NAME) {
    if (!loginDb) {
      loginDb = client.db(LOGIN_DB_NAME);
    }
    return loginDb;
  } else {
    // Support arbitrary DB names for other portals/tenants
    if (dbName && dbName !== EMPLOYEE_DB_NAME) {
      if (!dbCache.has(dbName)) {
        dbCache.set(dbName, client.db(dbName));
      }
      return dbCache.get(dbName);
    }

    if (!employeeDb) {
      employeeDb = client.db(EMPLOYEE_DB_NAME);
    }
    return employeeDb;
  }
}

/**
 * Get the employee collection name based on email domain or company name
 * @param {string} email - User email address (optional)
 * @param {string} company - Company name: 'Thrive' or 'Ecosoul Home' (optional)
 * @returns {string} Collection name (Thrive_Employees or Ecosoul_Employees)
 */
function getEmployeeCollectionName(email = null, company = null) {
  // If company name is provided, use it directly
  if (company) {
    const companyLower = company.toLowerCase();
    if (companyLower.includes('thrive')) {
      return 'Thrive_Employees';
    } else if (companyLower.includes('ecosoul')) {
      return 'Ecosoul_Employees';
    }
  }
  
  // If email is provided, determine from email domain
  if (email) {
    const emailLower = email.toLowerCase();
    
    if (emailLower.endsWith('@thrivebrands.ai')) {
      return 'Thrive_Employees';
    } else if (emailLower.endsWith('@ecosoulhome.com')) {
      return 'Ecosoul_Employees';
    }
  }
  
  // If neither provided, throw error
  throw new Error('Either email or company name is required to determine collection');
}

async function getUsersCollection(email = null, company = null) {
  // For login, use the configured login database (Employees_List)
  const db = await getDb(LOGIN_DB_NAME);
  
  // If email or company is provided, determine collection based on domain or company name
  if (email || company) {
    const collectionName = getEmployeeCollectionName(email, company);
    return db.collection(collectionName);
  }
  
  // Default to users collection if no email/company provided (for backward compatibility)
  return db.collection(USERS_COLLECTION);
}

/**
 * Initialize database and collections for a specific portal
 * @param {string} portalName - Portal key from PORTAL_CONFIG (e.g. 'hrms', 'assets')
 * @returns {Promise<void>}
 */
async function initializePortalDatabase(portalName) {
  try {
    await ensureConnection();
    
    const portalConfig = PORTAL_CONFIG[portalName];
    if (!portalConfig) {
      console.warn(`⚠️  [portal-setup] No configuration found for portal: ${portalName}`);
      return;
    }

    const dbName = portalConfig.database;
    const collections = portalConfig.collections;

    // Get or create database (MongoDB creates databases automatically when first collection is created)
    const db = client.db(dbName);
    
    // Check existing collections
    const existingCollections = await db.listCollections().toArray();
    const existingCollectionNames = existingCollections.map(col => col.name);
    
    // Create collections that don't exist
    for (const collectionName of collections) {
      if (!existingCollectionNames.includes(collectionName)) {
        try {
          // Create collection by inserting an empty document and then deleting it
          // This ensures the collection exists
          const collection = db.collection(collectionName);
          await collection.insertOne({ _initialized: true, createdAt: new Date() });
          await collection.deleteOne({ _initialized: true });
          console.log(`✅ [portal-setup] Created collection '${collectionName}' in database '${dbName}'`);
        } catch (err) {
          // If insert fails, try creating collection directly
          try {
            await db.createCollection(collectionName);
            console.log(`✅ [portal-setup] Created collection '${collectionName}' in database '${dbName}'`);
          } catch (createErr) {
            console.error(`❌ [portal-setup] Failed to create collection '${collectionName}': ${createErr.message}`);
          }
        }
      } else {
        console.log(`ℹ️  [portal-setup] Collection '${collectionName}' already exists in database '${dbName}'`);
      }
    }
    
    console.log(`✅ [portal-setup] Portal '${portalName}' database '${dbName}' initialized with ${collections.length} collections`);
  } catch (error) {
    console.error(`❌ [portal-setup] Failed to initialize portal '${portalName}': ${error.message}`);
    throw error;
  }
}

/**
 * Initialize all portal databases and collections
 * @returns {Promise<void>}
 */
async function initializeAllPortals() {
  try {
    await ensureConnection();
    console.log(`\n📦 [portal-setup] Initializing all portal databases and collections...\n`);
    
    // Also ensure login database has users collection
    const loginDb = client.db(LOGIN_DB_NAME);
    const loginCollections = await loginDb.listCollections().toArray();
    const loginCollectionNames = loginCollections.map(col => col.name);
    
    if (!loginCollectionNames.includes(USERS_COLLECTION)) {
      try {
        const usersCol = loginDb.collection(USERS_COLLECTION);
        await usersCol.insertOne({ _initialized: true, createdAt: new Date() });
        await usersCol.deleteOne({ _initialized: true });
        console.log(`✅ [portal-setup] Created collection '${USERS_COLLECTION}' in login database '${LOGIN_DB_NAME}'`);
      } catch (err) {
        console.error(`❌ [portal-setup] Failed to create users collection: ${err.message}`);
      }
    }
    
    // Initialize each portal
    for (const portalName of Object.keys(PORTAL_CONFIG)) {
      await initializePortalDatabase(portalName);
    }
    
    console.log(`\n✅ [portal-setup] All portal databases and collections initialized successfully!\n`);
  } catch (error) {
    console.error(`❌ [portal-setup] Failed to initialize portals: ${error.message}`);
    throw error;
  }
}

module.exports = {
  connectMongo,
  getDb,
  getEmployeePortalDb,
  getUsersCollection,
  getEmployeeCollectionName,
  initializePortalDatabase,
  initializeAllPortals,
  PORTAL_CONFIG,
  LOGIN_DB_NAME,
  EMPLOYEE_DB_NAME,
};
