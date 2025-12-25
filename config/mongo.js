const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';
const LOGIN_DB_NAME = process.env.MONGO_LOGIN_DB_NAME || 'ecosoul_project_tracker';
const EMPLOYEE_DB_NAME = process.env.MONGO_DB_NAME || 'Employee';
const USERS_COLLECTION = process.env.MONGO_USERS_COLLECTION || 'users';

let client;
let loginDb;
let employeeDb;

async function connectMongo(dbName = null) {
  if (!client) {
    try {
      client = new MongoClient(MONGO_URI, {
        maxPoolSize: 10,
        connectTimeoutMS: 10000,
      });
      await client.connect();
      console.log(`✅ [mongo] Connected to MongoDB at ${MONGO_URI}`);
    } catch (err) {
      console.error(`❌ [mongo] Connection failed: ${err.message}`);
      throw err;
    }
  }

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

function getDb(dbName = null) {
  const targetDb = dbName || EMPLOYEE_DB_NAME;
  
  if (targetDb === LOGIN_DB_NAME) {
    if (!loginDb) {
      throw new Error('Login MongoDB not connected yet. Call connectMongo("ecosoul_project_tracker") first.');
    }
    return loginDb;
  } else {
    if (!employeeDb) {
      throw new Error('Employee MongoDB not connected yet. Call connectMongo() first.');
    }
    return employeeDb;
  }
}

function getUsersCollection() {
  // For login, always use ecosoul_project_tracker database
  const db = getDb(LOGIN_DB_NAME);
  return db.collection(USERS_COLLECTION);
}

module.exports = {
  connectMongo,
  getDb,
  getUsersCollection,
  LOGIN_DB_NAME,
  EMPLOYEE_DB_NAME,
};
