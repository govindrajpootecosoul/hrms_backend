const { MongoClient } = require('mongodb');
const { config, getMongoUri } = require('./app.config');

// MongoDB connection URI - supports both dev and production
// If MONGO_URI is set, use it. Otherwise, use non-authenticated connection
// (Authentication can be enabled later via environment variable)
const MONGO_URI = getMongoUri();

const LOGIN_DB_NAME = config.mongodb.loginDbName;
const EMPLOYEE_DB_NAME = config.mongodb.employeeDbName;
const USERS_COLLECTION = config.mongodb.usersCollection;

let client;
let loginDb;
let employeeDb;
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
    if (!employeeDb) {
      employeeDb = client.db(EMPLOYEE_DB_NAME);
      console.log(`[mongo] Using employee database: ${EMPLOYEE_DB_NAME}`);
    }
    return employeeDb;
  }
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
    if (!employeeDb) {
      employeeDb = client.db(EMPLOYEE_DB_NAME);
    }
    return employeeDb;
  }
}

async function getUsersCollection() {
  // For login, always use ecosoul_project_tracker database
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(USERS_COLLECTION);
}

module.exports = {
  connectMongo,
  getDb,
  getUsersCollection,
  LOGIN_DB_NAME,
  EMPLOYEE_DB_NAME,
};
