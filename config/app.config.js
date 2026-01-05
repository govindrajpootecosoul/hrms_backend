require('dotenv').config();

/**
 * Centralized Application Configuration
 * All IPs, URLs, and Ports are managed here
 * DO NOT hardcode any IPs, URLs, or ports in other files
 */

const config = {
  // Server Ports
  ports: {
    backend: parseInt(process.env.BACKEND_PORT) || 5008,
    frontend: parseInt(process.env.FRONTEND_PORT) || 4000,
    queryTracker: parseInt(process.env.QUERY_TRACKER_PORT) || 5009,
  },

  // MongoDB Configuration
  mongodb: {
    host: process.env.MONGO_HOST || 'localhost',
    port: parseInt(process.env.MONGO_PORT) || 27017,
    uri: process.env.MONGO_URI || null, // If set, will override host:port
    loginDbName: process.env.MONGO_LOGIN_DB_NAME || 'ecosoul_project_tracker',
    employeeDbName: process.env.MONGO_DB_NAME || (process.env.NODE_ENV === 'production' ? 'hrms_prod' : 'Employee'),
    queryTrackerDbName: process.env.QUERY_TRACKER_DB_NAME || 'query_tracker',
    usersCollection: process.env.MONGO_USERS_COLLECTION || 'users',
  },

  // MySQL Configuration
  mysql: {
    host: process.env.DB_HOST || '192.168.50.29',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'apiuser',
    password: process.env.DB_PASSWORD || 'Thrive@2910',
    database: process.env.DB_NAME || 'worklytics_hrms',
    poolSize: parseInt(process.env.DB_POOL_SIZE) || 12,
  },

  // Server URLs
  urls: {
    // Base URLs
    backendBase: process.env.BACKEND_BASE_URL || null, // Will be constructed if not set
    frontendBase: process.env.FRONTEND_BASE_URL || null, // Will be constructed if not set
    
    // API Endpoints
    backendApi: process.env.BACKEND_API_URL || null, // Will be constructed if not set
    healthCheck: process.env.HEALTH_CHECK_URL || null, // Will be constructed if not set
  },

  // Network IPs (for external access)
  network: {
    serverIp: process.env.SERVER_IP || 'localhost', // Server's IP address for network access
  },

  // Environment
  env: {
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production',
  },
};

// Helper function to get MongoDB URI
function getMongoUri(databaseName = null) {
  if (config.mongodb.uri) {
    // If MONGO_URI is explicitly set, use it
    if (databaseName) {
      // Append database name if not already in URI
      const uri = config.mongodb.uri.endsWith('/') 
        ? config.mongodb.uri 
        : config.mongodb.uri + '/';
      return uri + databaseName;
    }
    return config.mongodb.uri;
  }
  
  // Construct URI from host and port
  const baseUri = `mongodb://${config.mongodb.host}:${config.mongodb.port}/`;
  return databaseName ? baseUri + databaseName : baseUri;
}

// Helper function to get backend URL
function getBackendUrl() {
  if (config.urls.backendBase) {
    return config.urls.backendBase;
  }
  const host = config.network.serverIp === 'localhost' ? 'localhost' : config.network.serverIp;
  return `http://${host}:${config.ports.backend}`;
}

// Helper function to get frontend URL
function getFrontendUrl() {
  if (config.urls.frontendBase) {
    return config.urls.frontendBase;
  }
  const host = config.network.serverIp === 'localhost' ? 'localhost' : config.network.serverIp;
  return `http://${host}:${config.ports.frontend}`;
}

// Helper function to get API URL
function getApiUrl() {
  if (config.urls.backendApi) {
    return config.urls.backendApi;
  }
  return `${getBackendUrl()}/api`;
}

// Helper function to get health check URL
function getHealthCheckUrl() {
  if (config.urls.healthCheck) {
    return config.urls.healthCheck;
  }
  return `${getBackendUrl()}/api/health`;
}

// Export configuration and helper functions
module.exports = {
  config,
  getMongoUri,
  getBackendUrl,
  getFrontendUrl,
  getApiUrl,
  getHealthCheckUrl,
  
  // Direct access to commonly used values
  ports: config.ports,
  mongodb: config.mongodb,
  mysql: config.mysql,
  urls: config.urls,
  network: config.network,
  env: config.env,
};

